use std::sync::Arc;

use crate::repositories::Repository;

#[derive(Clone)]
pub struct HealthService {
    repository: Arc<dyn Repository>,
}

impl HealthService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn database_is_healthy(&self) -> bool {
        self.repository.is_healthy().await
    }

    pub fn database_backend(&self) -> &'static str {
        self.repository.backend_name()
    }
}
