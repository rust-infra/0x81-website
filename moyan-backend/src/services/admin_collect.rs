//! Admin YouTube collect + LLM settings orchestration.

use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{
    mask_api_key, AdminCreateDeckRequest, CollectImportTarget, CreateCardRequest, DraftCard,
    LlmSettingsPublic, LlmSettingsStored, UpdateLlmSettingsRequest, YoutubeCaptionsRequest,
    YoutubeCaptionsResponse, YoutubeExtractRequest, YoutubeExtractResponse, YoutubeImportRequest,
    YoutubeImportResponse,
};
use crate::repositories::Repository;
use crate::services::admin::AdminService;
use crate::services::llm_client;
use crate::services::youtube_captions;

const LLM_SETTING_KEY: &str = "llm";

#[derive(Clone)]
pub struct AdminCollectService {
    repository: Arc<dyn Repository>,
    admin: AdminService,
}

impl AdminCollectService {
    pub fn new(repository: Arc<dyn Repository>, admin: AdminService) -> Self {
        Self { repository, admin }
    }

    pub async fn get_llm_settings(&self) -> Result<LlmSettingsPublic, AppError> {
        let stored = self.load_llm_settings().await?;
        Ok(to_public(stored))
    }

    pub async fn update_llm_settings(
        &self,
        req: UpdateLlmSettingsRequest,
    ) -> Result<LlmSettingsPublic, AppError> {
        let mut stored = self.load_llm_settings().await?;

        if let Some(base_url) = req.base_url {
            stored.base_url = base_url.trim().trim_end_matches('/').to_string();
        }
        if let Some(model) = req.model {
            stored.model = model.trim().to_string();
        }
        if let Some(temperature) = req.temperature {
            stored.temperature = temperature.clamp(0.0, 2.0);
        }
        if req.clear_api_key {
            stored.api_key.clear();
        } else if let Some(api_key) = req.api_key {
            let api_key = api_key.trim();
            if !api_key.is_empty() {
                stored.api_key = api_key.to_string();
            }
        }

        let value = serde_json::to_string(&stored)
            .map_err(|e| AppError::Internal(format!("serialize llm settings: {e}")))?;
        self.repository
            .admin_put_setting(LLM_SETTING_KEY, &value)
            .await?;
        Ok(to_public(stored))
    }

    pub async fn fetch_captions(
        &self,
        req: YoutubeCaptionsRequest,
    ) -> Result<YoutubeCaptionsResponse, AppError> {
        youtube_captions::fetch_youtube_captions(&req.url, req.proxy.as_deref()).await
    }

    pub async fn extract_cards(
        &self,
        req: YoutubeExtractRequest,
    ) -> Result<YoutubeExtractResponse, AppError> {
        let settings = self.load_llm_settings().await?;
        let outcome = llm_client::extract_vocabulary_cards(
            &settings,
            &req.video_id,
            &req.title,
            &req.caption_text,
            req.proxy.as_deref(),
        )
        .await?;
        Ok(YoutubeExtractResponse {
            draft_cards: outcome.draft_cards,
            truncated: outcome.truncated,
        })
    }

    pub async fn import_cards(
        &self,
        req: YoutubeImportRequest,
    ) -> Result<YoutubeImportResponse, AppError> {
        if req.cards.is_empty() {
            return Err(AppError::BadRequest("No cards to import".into()));
        }

        let deck_id = match req.target {
            CollectImportTarget::Create {
                name,
                description,
                source_key,
            } => {
                let deck = self
                    .admin
                    .create_deck(AdminCreateDeckRequest {
                        name,
                        description: description
                            .or_else(|| Some("Imported from YouTube collect".into())),
                        color: Some("#1677ff".into()),
                        source_key,
                        is_active: Some(true),
                        sort_order: Some(0),
                    })
                    .await?;
                deck.id
            }
            CollectImportTarget::Merge { deck_id } => {
                self.admin.require_system_deck_id(&deck_id).await?;
                deck_id
            }
        };

        let mut created = 0usize;
        let mut skipped = 0usize;
        for card in req.cards {
            let front = card.front.trim();
            if front.is_empty() {
                skipped += 1;
                continue;
            }
            if self
                .repository
                .admin_find_card_by_front(&deck_id, front)
                .await?
                .is_some()
            {
                skipped += 1;
                continue;
            }
            let create: CreateCardRequest = DraftCard {
                front: card.front,
                back: card.back,
                pronunciation: card.pronunciation,
                tags: card.tags,
                examples: card.examples,
            }
            .into_create_request();
            self.admin.create_card(&deck_id, create).await?;
            created += 1;
        }

        Ok(YoutubeImportResponse {
            deck_id,
            created_cards: created,
            skipped_cards: skipped,
        })
    }

    async fn load_llm_settings(&self) -> Result<LlmSettingsStored, AppError> {
        if let Some(raw) = self.repository.admin_get_setting(LLM_SETTING_KEY).await? {
            if let Ok(stored) = serde_json::from_str::<LlmSettingsStored>(&raw) {
                return Ok(fill_from_env_if_empty(stored));
            }
        }
        Ok(fill_from_env_if_empty(LlmSettingsStored::default()))
    }
}

fn fill_from_env_if_empty(mut stored: LlmSettingsStored) -> LlmSettingsStored {
    if stored.base_url.trim().is_empty() {
        if let Ok(v) = std::env::var("MOYAN_LLM_BASE_URL") {
            stored.base_url = v;
        } else if let Ok(v) = std::env::var("OPENAI_BASE_URL") {
            stored.base_url = v;
        } else {
            stored.base_url = "https://api.openai.com/v1".to_string();
        }
    }
    if stored.api_key.trim().is_empty() {
        if let Ok(v) = std::env::var("MOYAN_LLM_API_KEY") {
            stored.api_key = v;
        } else if let Ok(v) = std::env::var("OPENAI_API_KEY") {
            stored.api_key = v;
        }
    }
    if stored.model.trim().is_empty() {
        if let Ok(v) = std::env::var("MOYAN_LLM_MODEL") {
            stored.model = v;
        } else if let Ok(v) = std::env::var("OPENAI_MODEL") {
            stored.model = v;
        } else {
            stored.model = "gpt-4o-mini".to_string();
        }
    }
    stored
}

fn to_public(stored: LlmSettingsStored) -> LlmSettingsPublic {
    LlmSettingsPublic {
        base_url: stored.base_url,
        model: stored.model,
        temperature: stored.temperature,
        api_key_set: !stored.api_key.trim().is_empty(),
        api_key_masked: mask_api_key(&stored.api_key),
    }
}
