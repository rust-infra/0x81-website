use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMastery {
    pub card_id: String,
    pub accuracy: f64,
    pub egregious_count: i64,
    pub score: f64,
    pub last_practiced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeStatsResponse {
    pub recent_sessions: Vec<TypeSession>,
    pub daily_trend: Vec<TypeDailyTrend>,
    pub mastery: Vec<TypeMastery>,
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
