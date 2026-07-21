//! Business services that coordinate controllers and repositories.

mod admin;
mod auth;
mod health;
mod settings;
mod sync;
mod system_decks;
mod vocabulary;

use std::sync::Arc;

use crate::repositories::Repository;

pub use admin::AdminService;
pub use auth::AuthService;
pub use health::HealthService;
pub use settings::SettingsService;
pub use sync::SyncService;
pub use system_decks::SystemDecksService;
pub use vocabulary::VocabularyService;

#[derive(Clone)]
pub struct Services {
    pub auth: AuthService,
    pub health: HealthService,
    pub settings: SettingsService,
    pub sync: SyncService,
    pub vocabulary: VocabularyService,
    pub system_decks: SystemDecksService,
    pub admin: AdminService,
}

impl Services {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self {
            auth: AuthService::new(Arc::clone(&repository)),
            health: HealthService::new(Arc::clone(&repository)),
            settings: SettingsService::new(Arc::clone(&repository)),
            sync: SyncService::new(Arc::clone(&repository)),
            vocabulary: VocabularyService::new(Arc::clone(&repository)),
            system_decks: SystemDecksService::new(Arc::clone(&repository)),
            admin: AdminService::new(repository),
        }
    }
}
