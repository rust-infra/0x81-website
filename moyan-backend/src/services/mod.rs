//! Business services that coordinate controllers and repositories.

mod auth;
mod health;
mod settings;
mod sync;
mod vocabulary;

use std::sync::Arc;

use crate::repositories::Repository;

pub use auth::AuthService;
pub use health::HealthService;
pub use settings::SettingsService;
pub use sync::SyncService;
pub use vocabulary::VocabularyService;

#[derive(Clone)]
pub struct Services {
    pub auth: AuthService,
    pub health: HealthService,
    pub settings: SettingsService,
    pub sync: SyncService,
    pub vocabulary: VocabularyService,
}

impl Services {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self {
            auth: AuthService::new(Arc::clone(&repository)),
            health: HealthService::new(Arc::clone(&repository)),
            settings: SettingsService::new(Arc::clone(&repository)),
            sync: SyncService::new(Arc::clone(&repository)),
            vocabulary: VocabularyService::new(repository),
        }
    }
}
