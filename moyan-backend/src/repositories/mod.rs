//! Repository interfaces and storage implementations.

mod mongodb;
mod sqlite;

#[cfg(test)]
pub use sqlite::SqliteRepositories;

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use thiserror::Error;

use crate::models::{
    AdminVocabularyImportCard, AdminVocabularyImportDeck, Card, CardExample, CardProgress,
    CollectJob, CreateCardRequest, CreateDeckRequest, CreateReviewLogRequest, Deck, ImportMode,
    ImportResult, ReviewLog, StudyCard, StudyQueue, SyncData, SyncStatusResponse,
    TypeDailyTrend, TypeEntry, TypeMasteryRow, TypeResume, TypeSession, UpdateCardRequest,
    UpdateDeckRequest, UpsertCardProgressRequest, User, UserIdentity, UserSettings, UserStats,
};

pub async fn repository_from_env() -> Result<Arc<dyn Repository>, RepositoryError> {
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:data/moyan.db".to_string());
    let backend = std::env::var("DATABASE_BACKEND").unwrap_or_else(|_| {
        if database_url.starts_with("mongodb://") || database_url.starts_with("mongodb+srv://") {
            "mongodb".to_string()
        } else {
            "sqlite".to_string()
        }
    });

    match backend.to_ascii_lowercase().as_str() {
        "sqlite" => Ok(Arc::new(
            sqlite::SqliteRepositories::connect(&database_url).await?,
        )),
        "mongodb" | "mongo" => {
            let database =
                std::env::var("MONGODB_DATABASE").unwrap_or_else(|_| "moyan".to_string());
            Ok(Arc::new(
                mongodb::MongoRepositories::connect(&database_url, &database).await?,
            ))
        }
        value => Err(RepositoryError::Configuration(format!(
            "unsupported DATABASE_BACKEND '{value}'; expected sqlite or mongodb"
        ))),
    }
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("persistence error: {0}")]
    Persistence(String),
    #[error("repository configuration error: {0}")]
    Configuration(String),
    #[error("numeric conversion failed for {0}")]
    NumericConversion(&'static str),
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SyncCounts {
    pub decks: usize,
    pub cards: usize,
    pub logs: usize,
}

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_or_create(&self, identity: UserIdentity<'_>) -> Result<User, RepositoryError>;
    async fn find_by_id(&self, user_id: &str) -> Result<Option<User>, RepositoryError>;

    async fn admin_list_users(
        &self,
        q: Option<&str>,
        status: Option<&str>,
        role: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<User>, i64), RepositoryError>;
    async fn admin_update_user(
        &self,
        user_id: &str,
        status: Option<&str>,
        role: Option<&str>,
    ) -> Result<Option<User>, RepositoryError>;
    async fn admin_user_deck_summaries(
        &self,
        user_id: &str,
    ) -> Result<Vec<(Deck, i64)>, RepositoryError>;
    async fn admin_recent_sync_count(&self, user_id: &str) -> Result<i64, RepositoryError>;
}

#[async_trait]
pub trait LearningRepository: Send + Sync {
    async fn upload(
        &self,
        user_id: &str,
        data: &SyncData,
        synced_at: DateTime<Utc>,
    ) -> Result<SyncCounts, RepositoryError>;
    async fn download(&self, user_id: &str) -> Result<SyncData, RepositoryError>;
    async fn status(&self, user_id: &str) -> Result<SyncStatusResponse, RepositoryError>;
    async fn stats(&self, user_id: &str) -> Result<UserStats, RepositoryError>;
}

#[async_trait]
pub trait SettingsRepository: Send + Sync {
    async fn get_settings(&self, user_id: &str) -> Result<UserSettings, RepositoryError>;
    async fn save_settings(
        &self,
        user_id: &str,
        settings: &UserSettings,
    ) -> Result<UserSettings, RepositoryError>;
}

#[async_trait]
pub trait VocabularyRepository: Send + Sync {
    async fn list_decks_for_user(&self, user_id: &str) -> Result<Vec<Deck>, RepositoryError>;
    async fn get_deck(&self, deck_id: &str) -> Result<Option<Deck>, RepositoryError>;
    async fn create_user_deck(
        &self,
        user_id: &str,
        req: &CreateDeckRequest,
    ) -> Result<Deck, RepositoryError>;
    async fn update_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
        req: &UpdateDeckRequest,
    ) -> Result<Option<Deck>, RepositoryError>;
    async fn delete_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<bool, RepositoryError>;

    async fn list_cards(&self, deck_id: &str) -> Result<Vec<Card>, RepositoryError>;
    async fn get_card(&self, card_id: &str) -> Result<Option<Card>, RepositoryError>;
    async fn create_card(
        &self,
        deck_id: &str,
        req: &CreateCardRequest,
        examples: Vec<CardExample>,
    ) -> Result<Card, RepositoryError>;
    async fn update_card(
        &self,
        card_id: &str,
        req: &UpdateCardRequest,
        examples: Option<Vec<CardExample>>,
    ) -> Result<Option<Card>, RepositoryError>;
    async fn delete_card(&self, card_id: &str) -> Result<bool, RepositoryError>;

    async fn list_study_cards(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Vec<StudyCard>, RepositoryError>;
    /// Aggregate study queue across every deck the user can study.
    async fn study_queue(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<StudyQueue, RepositoryError>;
    async fn upsert_card_progress(
        &self,
        user_id: &str,
        card_id: &str,
        req: &UpsertCardProgressRequest,
    ) -> Result<CardProgress, RepositoryError>;
    async fn create_review_log(
        &self,
        user_id: &str,
        req: &CreateReviewLogRequest,
    ) -> Result<ReviewLog, RepositoryError>;

    async fn count_system_decks(&self) -> Result<i64, RepositoryError>;
    async fn insert_system_deck(&self, deck: &Deck) -> Result<(), RepositoryError>;
    async fn insert_system_card(&self, card: &Card) -> Result<(), RepositoryError>;
    async fn mark_system_decks_initialized(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError>;
    async fn get_system_decks_initialized_at(
        &self,
        user_id: &str,
    ) -> Result<Option<DateTime<Utc>>, RepositoryError>;
    async fn touch_last_login(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError>;

    async fn admin_list_system_decks(
        &self,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Deck>, i64), RepositoryError>;
    async fn admin_list_cards(
        &self,
        deck_id: &str,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Card>, i64), RepositoryError>;
    async fn admin_find_system_deck_by_source_key(
        &self,
        source_key: &str,
    ) -> Result<Option<Deck>, RepositoryError>;
    async fn admin_find_system_deck_by_name(
        &self,
        name: &str,
    ) -> Result<Option<Deck>, RepositoryError>;
    async fn admin_upsert_system_deck(&self, deck: &Deck) -> Result<Deck, RepositoryError>;
    async fn admin_delete_cards_in_deck(&self, deck_id: &str) -> Result<u64, RepositoryError>;
    async fn admin_delete_system_deck(&self, deck_id: &str) -> Result<bool, RepositoryError>;
    async fn admin_find_card_by_front(
        &self,
        deck_id: &str,
        front: &str,
    ) -> Result<Option<Card>, RepositoryError>;
    async fn admin_apply_vocabulary_import(
        &self,
        mode: ImportMode,
        decks: &[AdminVocabularyImportDeck],
        cards: &[AdminVocabularyImportCard],
    ) -> Result<ImportResult, RepositoryError>;

    async fn admin_get_setting(&self, key: &str) -> Result<Option<String>, RepositoryError>;
    async fn admin_put_setting(&self, key: &str, value: &str) -> Result<(), RepositoryError>;

    async fn collect_job_insert(&self, job: &CollectJob) -> Result<(), RepositoryError>;
    async fn collect_job_update(&self, job: &CollectJob) -> Result<(), RepositoryError>;
    async fn collect_job_get(&self, id: &str) -> Result<Option<CollectJob>, RepositoryError>;
    async fn collect_job_delete(&self, id: &str) -> Result<bool, RepositoryError>;
    async fn collect_job_list(
        &self,
        q: Option<&str>,
        status: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<CollectJob>, i64), RepositoryError>;
}

#[async_trait]
pub trait TypeRepository: Send + Sync {
    /// Insert a session; returns false when the id already exists (idempotent).
    async fn type_session_insert(
        &self,
        user_id: &str,
        session: &TypeSession,
    ) -> Result<bool, RepositoryError>;
    /// Insert entries, skipping ids that already exist; returns number inserted.
    async fn type_entries_insert(
        &self,
        user_id: &str,
        entries: &[TypeEntry],
    ) -> Result<usize, RepositoryError>;
    async fn type_recent_sessions(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<TypeSession>, RepositoryError>;
    async fn type_daily_trend(
        &self,
        user_id: &str,
        days: i64,
    ) -> Result<Vec<TypeDailyTrend>, RepositoryError>;
    async fn type_mastery_rows(
        &self,
        user_id: &str,
    ) -> Result<Vec<TypeMasteryRow>, RepositoryError>;
    /// Upsert the typing resume checkpoint for (user, deck_id).
    async fn type_resume_upsert(
        &self,
        user_id: &str,
        resume: &TypeResume,
    ) -> Result<(), RepositoryError>;
    async fn type_resume_get(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Option<TypeResume>, RepositoryError>;
    async fn type_resume_delete(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<bool, RepositoryError>;
}

#[async_trait]
pub trait HealthRepository: Send + Sync {
    async fn is_healthy(&self) -> bool;
    fn backend_name(&self) -> &'static str;
}

pub trait Repository:
    UserRepository
    + LearningRepository
    + SettingsRepository
    + VocabularyRepository
    + TypeRepository
    + HealthRepository
{
}

impl<T> Repository for T where
    T: UserRepository
        + LearningRepository
        + SettingsRepository
        + VocabularyRepository
        + TypeRepository
        + HealthRepository
{
}
