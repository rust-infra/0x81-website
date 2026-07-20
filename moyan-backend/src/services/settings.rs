use std::sync::Arc;

use crate::models::UserSettings;
use crate::repositories::{Repository, RepositoryError};

#[derive(Clone)]
pub struct SettingsService {
    repository: Arc<dyn Repository>,
}

impl SettingsService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn get(&self, user_id: &str) -> Result<UserSettings, RepositoryError> {
        self.repository.get_settings(user_id).await
    }

    pub async fn save(
        &self,
        user_id: &str,
        settings: &UserSettings,
    ) -> Result<UserSettings, RepositoryError> {
        self.repository.save_settings(user_id, settings).await
    }
}
