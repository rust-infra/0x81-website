//! Business services that coordinate controllers and repositories.

mod admin;
mod admin_collect;
mod admin_excel;
mod auth;
mod coach;
mod coach_quota;
mod coach_settings;
mod health;
pub(crate) mod interview_docs;
mod llm_client;
mod podcast;
mod settings;
mod sync;
mod system_decks;
mod typing;
mod vocabulary;
mod youtube_captions;

use std::sync::Arc;

use crate::repositories::Repository;

pub use admin::AdminService;
pub use coach::CoachService;
pub use coach_quota::{CoachQuotaService, CoachSettings};
pub use coach_settings::CoachSettingsService;
pub mod coach_scenarios;
pub use admin_collect::AdminCollectService;
pub use auth::AuthService;
pub use health::HealthService;
pub use podcast::PodcastService;
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
    pub admin_collect: Arc<AdminCollectService>,
    pub coach_quota: CoachQuotaService,
    pub coach: CoachService,
    pub coach_settings: CoachSettingsService,
    pub podcast: PodcastService,
    pub typing: TypeService,
}

impl Services {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        let admin = AdminService::new(Arc::clone(&repository));
        let admin_collect = Arc::new(AdminCollectService::new(
            Arc::clone(&repository),
            admin.clone(),
        ));
        let coach_quota = CoachQuotaService::new(Arc::clone(&repository));
        let coach = CoachService::new(
            Arc::clone(&repository),
            coach_quota.clone(),
            Arc::clone(&admin_collect),
        );
        let coach_settings = CoachSettingsService::new(Arc::clone(&repository));

        Self {
            auth: AuthService::new(Arc::clone(&repository)),
            health: HealthService::new(Arc::clone(&repository)),
            settings: SettingsService::new(Arc::clone(&repository)),
            sync: SyncService::new(Arc::clone(&repository)),
            vocabulary: VocabularyService::new(Arc::clone(&repository)),
            system_decks: SystemDecksService::new(Arc::clone(&repository)),
            admin,
            admin_collect,
            coach_quota,
            coach,
            coach_settings,
            podcast: PodcastService::new(Arc::clone(&repository)),
            typing: TypeService::new(Arc::clone(&repository)),
        }
    }
}
