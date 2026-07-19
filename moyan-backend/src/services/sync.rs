use std::sync::Arc;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::models::{SyncData, SyncStatusResponse};
use crate::repositories::{Repository, RepositoryError};

#[derive(Debug, Clone)]
pub struct SyncReceipt {
    pub sync_id: String,
    pub decks_synced: usize,
    pub cards_synced: usize,
    pub logs_synced: usize,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone)]
pub struct SyncService {
    repository: Arc<dyn Repository>,
}

impl SyncService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn upload(
        &self,
        user_id: &str,
        data: &SyncData,
    ) -> Result<SyncReceipt, RepositoryError> {
        let timestamp = Utc::now();
        let counts = self.repository.upload(user_id, data, timestamp).await?;
        Ok(SyncReceipt {
            sync_id: format!("sync_{}", Uuid::new_v4().simple()),
            decks_synced: counts.decks,
            cards_synced: counts.cards,
            logs_synced: counts.logs,
            timestamp,
        })
    }

    pub async fn download(&self, user_id: &str) -> Result<SyncData, RepositoryError> {
        self.repository.download(user_id).await
    }

    pub async fn status(&self, user_id: &str) -> Result<SyncStatusResponse, RepositoryError> {
        self.repository.status(user_id).await
    }
}
