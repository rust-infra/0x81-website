use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::{Card, CardProgress};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeEntry {
    pub id: String,
    pub card_id: String,
    pub deck_id: String,
    pub mode: String,
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub accuracy: f64,
    pub wpm: f64,
    pub duration_ms: i64,
    pub egregious: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSession {
    pub id: String,
    pub deck_id: Option<String>,
    pub deck_name: Option<String>,
    pub mode: String,
    pub total_cards: i64,
    pub completed: i64,
    pub skipped: i64,
    pub egregious_count: i64,
    pub avg_accuracy: f64,
    pub avg_wpm: f64,
    pub duration_ms: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDailyTrend {
    pub date: String,
    pub sessions: i64,
    pub avg_accuracy: f64,
    pub avg_wpm: f64,
}

/// Raw per-card aggregates; TypeService derives the 0-100 mastery score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMasteryRow {
    pub card_id: String,
    pub accuracy: f64,
    pub egregious_count: i64,
    pub last_practiced_at: Option<DateTime<Utc>>,
    /// Card front text, joined for display (None when the card was deleted).
    pub front: Option<String>,
    /// 累计字符数：都为 0 说明只有"跳过"记录，此时 accuracy 会是 1.0 但并非"练对了"，
    /// 调用方要据此决定是否外显准确率。
    pub correct_chars: i64,
    pub wrong_chars: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSyncRequest {
    pub session: TypeSession,
    pub entries: Vec<TypeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSyncResponse {
    pub saved_session: bool,
    pub saved_entries: usize,
}

/// Per-deck typing accuracy (all-time), used by the deck list badges.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDeckAccuracy {
    pub deck_id: String,
    pub accuracy: f64,
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub entries: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMastery {
    pub card_id: String,
    pub accuracy: f64,
    pub egregious_count: i64,
    pub score: f64,
    pub last_practiced_at: Option<DateTime<Utc>>,
    /// Card front text (None when the card no longer exists).
    #[serde(default)]
    pub front: Option<String>,
    /// 累计字符数（correct + wrong == 0 = 只有跳过记录，accuracy 1.0 不代表练对）
    #[serde(default)]
    pub correct_chars: i64,
    #[serde(default)]
    pub wrong_chars: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeStatsResponse {
    pub recent_sessions: Vec<TypeSession>,
    pub daily_trend: Vec<TypeDailyTrend>,
    pub mastery: Vec<TypeMastery>,
    /// All-time accuracy per deck (deck badges on the 词库 list).
    #[serde(default)]
    pub deck_accuracy: Vec<TypeDeckAccuracy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedCharState {
    pub state: String,
    #[serde(default)]
    pub input_char: Option<String>,
}

/// Per-deck typing resume checkpoint ('' deck_id = 全部词汇).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeResume {
    pub deck_id: String,
    pub deck_name: Option<String>,
    pub mode: String,
    pub card_id: String,
    pub target: String,
    pub char_index: i64,
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub typed_states: Vec<TypedCharState>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeResumeResponse {
    pub resume: Option<TypeResume>,
}

/// One word in the typing mistakes book (错题本).
///
/// `card` / `progress` mirror `StudyCard` so the typing page can practise the
/// mistakes book through the very same code path as a normal deck.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMistake {
    pub card_id: String,
    pub deck_id: String,
    /// How many times this word entered the mistakes book.
    pub wrong_count: i64,
    pub created_at: DateTime<Utc>,
    pub last_wrong_at: DateTime<Utc>,
    pub card: Card,
    pub progress: Option<CardProgress>,
    /// All-time per-card aggregates from `type_entries` (显示用的准确率/错字).
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub accuracy: f64,
    pub egregious_count: i64,
}

/// Raw row for `TypeMistake` (joined card + progress + entry aggregates).
#[derive(Debug, Clone)]
pub struct TypeMistakeRow {
    pub card_id: String,
    pub deck_id: String,
    pub wrong_count: i64,
    pub created_at: DateTime<Utc>,
    pub last_wrong_at: DateTime<Utc>,
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub egregious_count: i64,
    pub card: Card,
    pub progress: Option<CardProgress>,
}

impl TypeMistakeRow {
    pub fn into_mistake(self) -> TypeMistake {
        let total = self.correct_chars + self.wrong_chars;
        let accuracy = if total > 0 {
            self.correct_chars as f64 / total as f64
        } else {
            0.0
        };
        TypeMistake {
            card_id: self.card_id,
            deck_id: self.deck_id,
            wrong_count: self.wrong_count,
            created_at: self.created_at,
            last_wrong_at: self.last_wrong_at,
            card: self.card,
            progress: self.progress,
            correct_chars: self.correct_chars,
            wrong_chars: self.wrong_chars,
            accuracy,
            egregious_count: self.egregious_count,
        }
    }
}

/// Add/refresh one word in the mistakes book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMistakeAdd {
    pub card_id: String,
    pub deck_id: String,
    /// Entry id of the wrong attempt; makes retries idempotent.
    #[serde(default)]
    pub entry_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMistakeSyncRequest {
    #[serde(default)]
    pub add: Vec<TypeMistakeAdd>,
    /// Card ids that reached 100% accuracy in this batch.
    #[serde(default)]
    pub remove: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMistakeSyncResponse {
    /// 本批提交的打错条数（= 前端展示的"本次打错 N 次"）
    pub added: usize,
    /// 真正从错题本移除的行数
    pub removed: usize,
    /// 错题本当前词数
    pub total: i64,
    /// 其中因 entry_id 已经记过而**没有**重复计数的条数（幂等生效的证据）
    #[serde(default)]
    pub deduplicated: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMistakeListResponse {
    pub items: Vec<TypeMistake>,
}
