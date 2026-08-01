use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncData {
    pub decks: Vec<DeckData>,
    pub cards: Vec<CardData>,
    #[serde(default)]
    pub review_logs: Vec<ReviewLogData>,
    #[serde(default)]
    pub settings: Option<UserSettings>,
    #[serde(default)]
    pub sync_timestamp: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckData {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub card_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardData {
    pub id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub example: Option<String>,
    pub pronunciation: Option<String>,
    pub tags: Option<String>,
    pub srs_level: i32,
    pub srs_status: String,
    pub srs_next_review: Option<DateTime<Utc>>,
    pub srs_interval: f64,
    pub srs_ease: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewLogData {
    pub id: String,
    pub card_id: String,
    pub rating: String,
    pub reviewed_at: DateTime<Utc>,
    pub time_ms: Option<i32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct UserSettings {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub speech_provider: Option<String>,
    pub speech_voice: Option<String>,
    pub speech_zh_voice: Option<String>,
    pub speech_model: Option<String>,
    pub speech_speed: Option<f64>,
    pub auto_play: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusResponse {
    pub last_sync_at: Option<DateTime<Utc>>,
    pub has_data: bool,
    pub cards_count: i64,
    pub decks_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStats {
    pub cards_count: i64,
    pub decks_count: i64,
    pub reviews_count: i64,
}

/// Per-day study aggregate for the mobile stats trend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyTrendPoint {
    pub date: String,
    pub reviews: i64,
    pub accuracy: f64,
}
