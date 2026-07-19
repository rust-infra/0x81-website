//! Repository interfaces and storage implementations.

mod mongodb;
mod sqlite;

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use thiserror::Error;

use crate::models::{SyncData, SyncStatusResponse, User, UserIdentity, UserStats};

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
pub trait HealthRepository: Send + Sync {
    async fn is_healthy(&self) -> bool;
    fn backend_name(&self) -> &'static str;
}

pub trait Repository: UserRepository + LearningRepository + HealthRepository {}

impl<T> Repository for T where T: UserRepository + LearningRepository + HealthRepository {}
