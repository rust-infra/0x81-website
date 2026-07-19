//! Business services that coordinate controllers and repositories.

mod auth;
mod health;
mod sync;

use std::sync::Arc;

use crate::repositories::Repository;

pub use auth::AuthService;
pub use health::HealthService;
pub use sync::SyncService;

#[derive(Clone)]
pub struct Services {
    pub auth: AuthService,
    pub health: HealthService,
    pub sync: SyncService,
}

impl Services {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self {
            auth: AuthService::new(Arc::clone(&repository)),
            health: HealthService::new(Arc::clone(&repository)),
            sync: SyncService::new(repository),
        }
    }
}
