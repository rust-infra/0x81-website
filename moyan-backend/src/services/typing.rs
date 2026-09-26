use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{
    TypeEntry, TypeMastery, TypeMasteryRow, TypeMistakeAdd, TypeMistakeListResponse,
    TypeMistakeSyncRequest, TypeMistakeSyncResponse, TypeResume, TypeResumeResponse, TypeSession,
    TypeStatsResponse, TypeSyncRequest, TypeSyncResponse,
};
use crate::repositories::Repository;

pub const TYPE_SYNC_ENTRY_LIMIT: usize = 2000;
/// Upper bound for one mistakes-book batch (add + remove separately).
pub const TYPE_MISTAKE_SYNC_LIMIT: usize = 2000;
pub const TYPE_RECENT_SESSION_LIMIT: i64 = 20;
pub const TYPE_TREND_DAYS: i64 = 30;
const VALID_TYPE_MODES: &[&str] = &["word", "sentence"];
const MASTERY_EGREGIOUS_PENALTY: f64 = 15.0;
/// Fallback deck id when a typing entry has no deck (matches the frontend 'all').
const DEFAULT_DECK_ID: &str = "all";

#[derive(Clone)]
pub struct TypeService {
    repository: Arc<dyn Repository>,
}

impl TypeService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn sync(
        &self,
        user_id: &str,
        req: TypeSyncRequest,
    ) -> Result<TypeSyncResponse, AppError> {
        if req.entries.len() > TYPE_SYNC_ENTRY_LIMIT {
            return Err(AppError::BadRequest(format!(
                "too many entries: {} (max {TYPE_SYNC_ENTRY_LIMIT})",
                req.entries.len()
            )));
        }
        validate_session(&req.session)?;
        for entry in &req.entries {
            validate_entry(entry)?;
        }
        let saved_session = self
            .repository
            .type_session_insert(user_id, &req.session)
            .await?;
        let saved_entries = self
            .repository
            .type_entries_insert(user_id, &req.entries)
            .await?;
        Ok(TypeSyncResponse {
            saved_session,
            saved_entries,
        })
    }

    pub async fn stats(&self, user_id: &str) -> Result<TypeStatsResponse, AppError> {
        let recent_sessions = self
            .repository
            .type_recent_sessions(user_id, TYPE_RECENT_SESSION_LIMIT)
            .await?;
        let daily_trend = self
            .repository
            .type_daily_trend(user_id, TYPE_TREND_DAYS)
            .await?;
        let rows = self.repository.type_mastery_rows(user_id).await?;
        let mastery = rows.into_iter().map(mastery_from_row).collect();
        let deck_accuracy = self.repository.type_deck_accuracy(user_id).await?;
        Ok(TypeStatsResponse {
            recent_sessions,
            daily_trend,
            mastery,
            deck_accuracy,
        })
    }

    /// Mistakes book: every word that was typed wrong, most recently missed first.
    pub async fn mistakes(&self, user_id: &str) -> Result<TypeMistakeListResponse, AppError> {
        let rows = self.repository.type_mistake_list(user_id).await?;
        Ok(TypeMistakeListResponse {
            items: rows.into_iter().map(|r| r.into_mistake()).collect(),
        })
    }

    /// Apply one typing batch to the mistakes book.
    ///
    /// 口径与打字统计一致（逐键计数）：某个词这次练习 `wrong_chars > 0` → 进错题本；
    /// `wrong_chars == 0` 且真的敲过字 → 100% 准确率 → 移出。跳过的词不参与。
    pub async fn mistakes_sync(
        &self,
        user_id: &str,
        req: TypeMistakeSyncRequest,
    ) -> Result<TypeMistakeSyncResponse, AppError> {
        if req.add.len() > TYPE_MISTAKE_SYNC_LIMIT || req.remove.len() > TYPE_MISTAKE_SYNC_LIMIT {
            return Err(AppError::BadRequest(format!(
                "too many mistakes in one batch (max {TYPE_MISTAKE_SYNC_LIMIT})"
            )));
        }
        // Same card may appear several times in a batch: the last occurrence wins
        // (it carries the newest entry id, keeping retries idempotent).
        let mut adds: Vec<TypeMistakeAdd> = Vec::new();
        for add in req.add {
            let card_id = add.card_id.trim().to_string();
            if card_id.is_empty() {
                return Err(AppError::BadRequest("card_id is required".into()));
            }
            let deck_id = if add.deck_id.trim().is_empty() {
                DEFAULT_DECK_ID.to_string()
            } else {
                add.deck_id.trim().to_string()
            };
            let item = TypeMistakeAdd {
                card_id,
                deck_id,
                entry_id: add.entry_id.filter(|e| !e.trim().is_empty()),
            };
            match adds.iter_mut().find(|a| a.card_id == item.card_id) {
                Some(existing) => *existing = item,
                None => adds.push(item),
            }
        }

        let mut removes: Vec<String> = Vec::new();
        for card_id in req.remove {
            let card_id = card_id.trim().to_string();
            if card_id.is_empty() {
                continue;
            }
            if !removes.contains(&card_id) {
                removes.push(card_id);
            }
        }

        // 整批一次事务：内部先 remove 后 add（同批同词都出现时留在错题本里），
        // 且 entry_id 已记过的 add 会被幂等跳过。正常前端只发连续切片，不会出现同批同现。
        // 入参条数即"本次打错次数"（added 字段语义就是这个），仓储返回的新增行数不直接用
        let (_inserted, removed, deduplicated) = self
            .repository
            .type_mistakes_apply(user_id, &adds, &removes)
            .await?;
        let total = self.repository.type_mistake_count(user_id).await?;
        Ok(TypeMistakeSyncResponse {
            added: adds.len(),
            removed,
            total,
            deduplicated,
        })
    }

    pub async fn put_resume(&self, user_id: &str, req: TypeResume) -> Result<(), AppError> {
        validate_resume(&req)?;
        self.repository.type_resume_upsert(user_id, &req).await?;
        Ok(())
    }

    pub async fn get_resume(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<TypeResumeResponse, AppError> {
        Ok(TypeResumeResponse {
            resume: self.repository.type_resume_get(user_id, deck_id).await?,
        })
    }

    pub async fn delete_resume(&self, user_id: &str, deck_id: &str) -> Result<(), AppError> {
        self.repository.type_resume_delete(user_id, deck_id).await?;
        Ok(())
    }
}

fn validate_session(session: &TypeSession) -> Result<(), AppError> {
    if !VALID_TYPE_MODES.contains(&session.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid mode '{}'; expected word or sentence",
            session.mode
        )));
    }
    if !(0.0..=1.0).contains(&session.avg_accuracy) {
        return Err(AppError::BadRequest(
            "avg_accuracy must be between 0 and 1".into(),
        ));
    }
    if session.total_cards < 0
        || session.completed < 0
        || session.skipped < 0
        || session.egregious_count < 0
        || session.duration_ms < 0
    {
        return Err(AppError::BadRequest(
            "session counts and duration must be non-negative".into(),
        ));
    }
    Ok(())
}

fn validate_entry(entry: &TypeEntry) -> Result<(), AppError> {
    if !VALID_TYPE_MODES.contains(&entry.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid mode '{}'; expected word or sentence",
            entry.mode
        )));
    }
    if !(0.0..=1.0).contains(&entry.accuracy) {
        return Err(AppError::BadRequest(
            "accuracy must be between 0 and 1".into(),
        ));
    }
    if entry.correct_chars < 0
        || entry.wrong_chars < 0
        || entry.duration_ms < 0
        || entry.wpm < 0.0
    {
        return Err(AppError::BadRequest(
            "entry stats must be non-negative".into(),
        ));
    }
    Ok(())
}

fn validate_resume(resume: &TypeResume) -> Result<(), AppError> {
    if !VALID_TYPE_MODES.contains(&resume.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid mode '{}'; expected word or sentence",
            resume.mode
        )));
    }
    if resume.char_index < 0
        || resume.correct_chars < 0
        || resume.wrong_chars < 0
        || resume.typed_states.len() as i64 != resume.char_index
    {
        return Err(AppError::BadRequest(
            "resume counts and typed_states length must match char_index".into(),
        ));
    }
    if resume.card_id.trim().is_empty() || resume.target.trim().is_empty() {
        return Err(AppError::BadRequest(
            "card_id and target are required".into(),
        ));
    }
    Ok(())
}

fn mastery_from_row(row: TypeMasteryRow) -> TypeMastery {
    let score = (row.accuracy * 100.0 - row.egregious_count as f64 * MASTERY_EGREGIOUS_PENALTY)
        .clamp(0.0, 100.0)
        .round();
    TypeMastery {
        card_id: row.card_id,
        accuracy: row.accuracy,
        egregious_count: row.egregious_count,
        score,
        last_practiced_at: row.last_practiced_at,
        front: row.front,
        correct_chars: row.correct_chars,
        wrong_chars: row.wrong_chars,
    }
}
