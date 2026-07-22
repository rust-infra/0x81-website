use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const SYSTEM_OWNER_ID: &str = "system";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardExample {
    pub id: String,
    pub sentence_en: String,
    pub translation_zh: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: String,
    pub owner_user_id: String,
    pub source_key: Option<String>,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub version: i32,
    pub sort_order: i32,
    pub is_active: bool,
    pub card_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    pub tags: Vec<String>,
    pub examples: Vec<CardExample>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardProgress {
    pub id: String,
    pub owner_user_id: String,
    pub card_id: String,
    pub srs_status: String,
    pub interval: f64,
    pub repetitions: i32,
    pub ease_factor: f64,
    pub due_date: DateTime<Utc>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyCard {
    pub card: Card,
    pub progress: Option<CardProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewLog {
    pub id: String,
    pub owner_user_id: String,
    pub card_id: String,
    pub deck_id: String,
    pub rating: String,
    pub time_ms: Option<i32>,
    pub reviewed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateDeckRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateDeckRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCardRequest {
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    pub tags: Option<Vec<String>>,
    pub examples: Option<Vec<CardExampleInput>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCardRequest {
    pub front: Option<String>,
    pub back: Option<String>,
    pub pronunciation: Option<String>,
    pub tags: Option<Vec<String>>,
    pub examples: Option<Vec<CardExampleInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardExampleInput {
    pub id: Option<String>,
    pub sentence_en: String,
    pub translation_zh: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertCardProgressRequest {
    pub srs_status: String,
    pub interval: f64,
    pub repetitions: i32,
    pub ease_factor: f64,
    pub due_date: DateTime<Utc>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateReviewLogRequest {
    pub card_id: String,
    pub deck_id: String,
    pub rating: String,
    pub time_ms: Option<i32>,
    pub reviewed_at: Option<DateTime<Utc>>,
}
