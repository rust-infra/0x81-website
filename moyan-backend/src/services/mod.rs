//! Business services that coordinate controllers and repositories.

mod admin;
mod admin_collect;
mod admin_excel;
mod auth;
mod health;
mod llm_client;
mod settings;
mod sync;
mod system_decks;
mod typing;
mod vocabulary;
mod youtube_captions;

use std::sync::Arc;

use crate::repositories::Repository;

pub use admin::AdminService;
pub use admin_collect::AdminCollectService;
pub use auth::AuthService;
pub use health::HealthService;
pub use settings::SettingsService;
pub use sync::SyncService;
pub use system_decks::SystemDecksService;
pub use typing::TypeService;
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
    pub admin_collect: AdminCollectService,
    pub typing: TypeService,
}

impl Services {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        let admin = AdminService::new(Arc::clone(&repository));
        let admin_collect = AdminCollectService::new(Arc::clone(&repository), admin.clone());
        Self {
            auth: AuthService::new(Arc::clone(&repository)),
            health: HealthService::new(Arc::clone(&repository)),
            settings: SettingsService::new(Arc::clone(&repository)),
            sync: SyncService::new(Arc::clone(&repository)),
            vocabulary: VocabularyService::new(Arc::clone(&repository)),
            system_decks: SystemDecksService::new(Arc::clone(&repository)),
            admin,
            admin_collect,
            typing: TypeService::new(Arc::clone(&repository)),
        }
    }
}
