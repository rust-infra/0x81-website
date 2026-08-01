use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{
    TypeEntry, TypeMastery, TypeMasteryRow, TypeSession, TypeStatsResponse, TypeSyncRequest,
    TypeSyncResponse,
};
use crate::repositories::Repository;

pub const TYPE_SYNC_ENTRY_LIMIT: usize = 2000;
pub const TYPE_RECENT_SESSION_LIMIT: i64 = 20;
pub const TYPE_TREND_DAYS: i64 = 30;
const VALID_TYPE_MODES: &[&str] = &["word", "sentence"];
const MASTERY_EGREGIOUS_PENALTY: f64 = 15.0;

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
        Ok(TypeStatsResponse {
            recent_sessions,
            daily_trend,
            mastery,
        })
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
    }
}
