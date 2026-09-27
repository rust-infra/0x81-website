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
mod interview_ocr;
mod interview_profile;
pub use interview_ocr::InterviewOcrService;
pub use interview_profile::InterviewProfileService;
pub(crate) mod llm_client;
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

/// LLMs occasionally wrap JSON in markdown fences despite the prompt. Keep
/// parsing tolerant in one place for coach, draft, OCR and profile payloads.
pub(crate) fn strip_code_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_open = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    without_open
        .strip_suffix("```")
        .unwrap_or(without_open)
        .trim()
        .to_string()
}

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
    pub interview_ocr: InterviewOcrService,
    pub interview_profile: InterviewProfileService,
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
        let interview_ocr =
            InterviewOcrService::new(coach_quota.clone(), Arc::clone(&admin_collect));
        let interview_profile =
            InterviewProfileService::new(coach_quota.clone(), Arc::clone(&admin_collect));

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
            interview_ocr,
            interview_profile,
            podcast: PodcastService::new(Arc::clone(&repository)),
            typing: TypeService::new(Arc::clone(&repository)),
        }
    }
}
