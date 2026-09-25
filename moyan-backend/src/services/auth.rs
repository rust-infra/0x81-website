use std::sync::Arc;

use crate::models::{User, UserIdentity, UserStats};
use crate::repositories::{Repository, RepositoryError};

#[derive(Clone)]
pub struct AuthService {
    repository: Arc<dyn Repository>,
}

impl AuthService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn find_or_create_user(
        &self,
        identity: UserIdentity<'_>,
    ) -> Result<User, RepositoryError> {
        self.repository.find_or_create(identity).await
    }

    pub async fn current_user(&self, user_id: &str) -> Result<Option<User>, RepositoryError> {
        self.repository.find_by_id(user_id).await
    }

    pub async fn find_by_provider(
        &self,
        provider: &str,
        provider_id: &str,
    ) -> Result<Option<User>, RepositoryError> {
        self.repository
            .find_by_provider(provider, provider_id)
            .await
    }

    pub async fn user_stats(&self, user_id: &str) -> Result<UserStats, RepositoryError> {
        self.repository.stats(user_id).await
    }
}
