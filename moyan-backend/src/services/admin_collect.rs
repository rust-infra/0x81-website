//! Admin YouTube collect + LLM settings orchestration.

use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{
    mask_api_key, AdminCreateDeckRequest, CollectImportTarget, CollectJob, CollectJobListItem,
    CollectJobListQuery, CollectJobListResponse, CollectJobStatus, CreateCardRequest,
    CreateCollectJobRequest, DraftCard, LlmSettingsPublic, LlmSettingsStored,
    UpdateLlmSettingsRequest, YoutubeCaptionsRequest, YoutubeCaptionsResponse,
    YoutubeExtractRequest, YoutubeExtractResponse, YoutubeImportRequest, YoutubeImportResponse,
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
                let source_key = {
                    let base = source_key
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| "yt_import".to_string());
                    format!("{base}_{}", Uuid::new_v4().simple())
                };
                let deck = self
                    .admin
                    .create_deck(AdminCreateDeckRequest {
                        name,
                        description: description
                            .or_else(|| Some("Imported from YouTube collect".into())),
                        color: Some("#1677ff".into()),
                        source_key: Some(source_key),
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

    pub async fn create_job(&self, req: CreateCollectJobRequest) -> Result<CollectJob, AppError> {
        let url = req.url.trim().to_string();
        if url.is_empty() {
            return Err(AppError::BadRequest("url is required".into()));
        }
        let proxy = req
            .proxy
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty());
        let now = Utc::now().to_rfc3339();
        let job = CollectJob {
            id: format!("cjob_{}", Uuid::new_v4().simple()),
            url,
            proxy,
            status: CollectJobStatus::Queued.as_str().to_string(),
            step: "queued".into(),
            error: None,
            video_id: None,
            title: None,
            language: None,
            source_url: None,
            caption_text: None,
            draft_cards: Vec::new(),
            truncated: false,
            cancel_requested: false,
            created_at: now.clone(),
            updated_at: now,
            started_at: None,
            finished_at: None,
            llm_started_at: None,
            llm_chunk_done: 0,
            llm_chunk_total: 0,
        };
        self.repository.collect_job_insert(&job).await?;
        self.spawn_worker(job.id.clone());
        Ok(job)
    }

    /// Re-launch workers for jobs left in a running state by a previous process
    /// (queued, fetching captions, or mid-extraction). Mid-extraction jobs resume
    /// from the next unfinished caption chunk using their stored captions.
    pub async fn recover_interrupted_jobs(&self) -> Result<usize, AppError> {
        let mut recovered = 0usize;
        for status in [
            CollectJobStatus::Queued.as_str(),
            CollectJobStatus::FetchingCaptions.as_str(),
            CollectJobStatus::Extracting.as_str(),
        ] {
            let (jobs, _) = self
                .repository
                .collect_job_list(None, Some(status), 0, 1000)
                .await?;
            for job in jobs {
                if job.cancel_requested {
                    continue;
                }
                self.spawn_worker(job.id.clone());
                recovered += 1;
            }
        }
        Ok(recovered)
    }

    pub async fn list_jobs(
        &self,
        query: CollectJobListQuery,
    ) -> Result<CollectJobListResponse, AppError> {
        if let Some(status) = query.status.as_deref() {
            if CollectJobStatus::parse(status).is_none() {
                return Err(AppError::BadRequest(format!("invalid status: {status}")));
            }
        }
        let page = query.page();
        let page_size = query.page_size();
        let (jobs, total) = self
            .repository
            .collect_job_list(
                query.q.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                query.status.as_deref(),
                query.offset(),
                page_size as i64,
            )
            .await?;
        Ok(CollectJobListResponse {
            items: jobs.iter().map(CollectJobListItem::from).collect(),
            total,
            page,
            page_size,
        })
    }

    pub async fn get_job(&self, id: &str) -> Result<CollectJob, AppError> {
        self.repository
            .collect_job_get(id)
            .await?
            .ok_or_else(|| AppError::NotFound("Collect job not found".into()))
    }

    pub async fn delete_job(&self, id: &str) -> Result<(), AppError> {
        if let Some(mut job) = self.repository.collect_job_get(id).await? {
            if CollectJobStatus::parse(&job.status)
                .map(|s| s.is_running())
                .unwrap_or(false)
            {
                job.cancel_requested = true;
                job.updated_at = Utc::now().to_rfc3339();
                let _ = self.repository.collect_job_update(&job).await;
            }
        }
        let deleted = self.repository.collect_job_delete(id).await?;
        if !deleted {
            return Err(AppError::NotFound("Collect job not found".into()));
        }
        Ok(())
    }

    pub async fn pause_job(&self, id: &str) -> Result<CollectJob, AppError> {
        let mut job = self.get_job(id).await?;
        let status = CollectJobStatus::parse(&job.status)
            .ok_or_else(|| AppError::BadRequest("invalid job status".into()))?;
        match status {
            CollectJobStatus::Ready | CollectJobStatus::Failed | CollectJobStatus::Paused => {
                return Err(AppError::BadRequest(format!(
                    "cannot pause job in status {}",
                    job.status
                )));
            }
            CollectJobStatus::Queued => {
                let now = Utc::now().to_rfc3339();
                job.status = CollectJobStatus::Paused.as_str().to_string();
                job.step = "paused".into();
                job.cancel_requested = true;
                job.updated_at = now.clone();
                job.finished_at = Some(now);
                self.repository.collect_job_update(&job).await?;
                return Ok(job);
            }
            CollectJobStatus::FetchingCaptions | CollectJobStatus::Extracting => {
                job.cancel_requested = true;
                job.updated_at = Utc::now().to_rfc3339();
                self.repository.collect_job_update(&job).await?;
                Ok(job)
            }
        }
    }

    pub async fn copy_job(&self, id: &str) -> Result<CollectJob, AppError> {
        let source = self.get_job(id).await?;
        self.create_job(CreateCollectJobRequest {
            url: source.url,
            proxy: source.proxy,
        })
        .await
    }

    fn spawn_worker(&self, job_id: String) {
        let this = self.clone();
        tokio::spawn(async move {
            if let Err(err) = this.run_job(&job_id).await {
                tracing::error!(job_id = %job_id, error = %app_error_message(&err), "collect job failed");
                let _ = this.fail_job(&job_id, app_error_message(&err)).await;
            }
        });
    }

    async fn run_job(&self, job_id: &str) -> Result<(), AppError> {
        let mut job = match self.repository.collect_job_get(job_id).await? {
            Some(job) => job,
            None => return Ok(()),
        };
        if job.cancel_requested || job.status == CollectJobStatus::Paused.as_str() {
            return self.mark_paused(job).await;
        }

        // Give pause/delete a chance to land while still queued (esp. stub mode).
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        job = match self.reload_or_gone(job_id).await? {
            Some(j) => j,
            None => return Ok(()),
        };
        if job.cancel_requested || job.status == CollectJobStatus::Paused.as_str() {
            return self.mark_paused(job).await;
        }

        let plan = resume_plan(&job);

        if !plan.resume_from_extract {
            let now = Utc::now().to_rfc3339();
            job.status = CollectJobStatus::FetchingCaptions.as_str().to_string();
            job.step = "fetching_captions".into();
            job.error = None;
            job.started_at = Some(now.clone());
            job.updated_at = now;
            self.repository.collect_job_update(&job).await?;

            let captions = youtube_captions::fetch_youtube_captions(
                &job.url,
                job.proxy.as_deref(),
            )
            .await?;

            job = match self.reload_or_gone(job_id).await? {
                Some(j) => j,
                None => return Ok(()),
            };
            if job.cancel_requested {
                return self.mark_paused(job).await;
            }

            job.video_id = Some(captions.video_id.clone());
            job.title = Some(captions.title.clone());
            job.language = Some(captions.language.clone());
            job.source_url = Some(captions.source_url.clone());
            job.caption_text = Some(captions.caption_text.clone());
            let llm_now = Utc::now().to_rfc3339();
            job.status = CollectJobStatus::Extracting.as_str().to_string();
            job.step = "extracting".into();
            job.llm_started_at = Some(llm_now.clone());
            job.llm_chunk_done = 0;
            job.llm_chunk_total = 0;
            job.updated_at = llm_now;
            self.repository.collect_job_update(&job).await?;
        } else {
            // Process restarted mid-extraction: keep stored captions/progress and
            // continue from the next unfinished chunk.
            job.step = format!(
                "extracting {}/{}",
                job.llm_chunk_done, job.llm_chunk_total
            );
            job.updated_at = Utc::now().to_rfc3339();
            self.repository.collect_job_update(&job).await?;
        }

        let settings = self.load_llm_settings().await?;
        // Prefer explicit MOYAN_LLM_PROXY; otherwise reuse collect proxy (needed when
        // the LLM API is not reachable without a tunnel).
        let llm_proxy = std::env::var("MOYAN_LLM_PROXY")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| job.proxy.clone());
        let video_id = job.video_id.clone().unwrap_or_default();
        let title = job.title.clone().unwrap_or_default();
        let caption = job.caption_text.clone().unwrap_or_default();
        let initial_cards: Vec<DraftCard> = if plan.resume_from_extract {
            job.draft_cards.clone()
        } else {
            Vec::new()
        };
        let this = self.clone();
        let progress_job_id = job_id.to_string();
        let outcome = llm_client::extract_vocabulary_cards_with_progress(
            &settings,
            &video_id,
            &title,
            &caption,
            llm_proxy.as_deref(),
            plan.start_chunk,
            &initial_cards,
            |cards, done, total| {
                let this = this.clone();
                let job_id = progress_job_id.clone();
                let cards = cards.to_vec();
                async move {
                    let Some(mut job) = this.repository.collect_job_get(&job_id).await? else {
                        return Ok(());
                    };
                    if job.cancel_requested {
                        return Err(AppError::BadRequest("job paused/cancelled".into()));
                    }
                    job.draft_cards = cards;
                    job.llm_chunk_done = done as u32;
                    job.llm_chunk_total = total as u32;
                    job.step = format!("extracting {done}/{total}");
                    job.updated_at = Utc::now().to_rfc3339();
                    this.repository.collect_job_update(&job).await?;
                    Ok(())
                }
            },
        )
        .await?;

        job = match self.reload_or_gone(job_id).await? {
            Some(j) => j,
            None => return Ok(()),
        };
        if job.cancel_requested {
            return self.mark_paused(job).await;
        }

        let finished = Utc::now().to_rfc3339();
        job.draft_cards = outcome.draft_cards;
        job.truncated = outcome.truncated;
        if job.llm_chunk_total > 0 {
            job.llm_chunk_done = job.llm_chunk_total;
        }
        job.status = CollectJobStatus::Ready.as_str().to_string();
        job.step = "ready".into();
        job.error = None;
        job.cancel_requested = false;
        job.updated_at = finished.clone();
        job.finished_at = Some(finished);
        self.repository.collect_job_update(&job).await?;
        Ok(())
    }

    async fn reload_or_gone(&self, job_id: &str) -> Result<Option<CollectJob>, AppError> {
        Ok(self.repository.collect_job_get(job_id).await?)
    }

    async fn mark_paused(&self, mut job: CollectJob) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();
        job.status = CollectJobStatus::Paused.as_str().to_string();
        job.step = "paused".into();
        job.updated_at = now.clone();
        job.finished_at = Some(now);
        self.repository.collect_job_update(&job).await?;
        Ok(())
    }

    async fn fail_job(&self, job_id: &str, error: String) -> Result<(), AppError> {
        let Some(mut job) = self.repository.collect_job_get(job_id).await? else {
            return Ok(());
        };
        if job.cancel_requested {
            return self.mark_paused(job).await;
        }
        let now = Utc::now().to_rfc3339();
        job.status = CollectJobStatus::Failed.as_str().to_string();
        job.step = "failed".into();
        job.error = Some(error);
        job.updated_at = now.clone();
        job.finished_at = Some(now);
        self.repository.collect_job_update(&job).await?;
        Ok(())
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

struct ResumePlan {
    resume_from_extract: bool,
    start_chunk: usize,
}

/// Decide whether a collect job can continue from its stored extraction state
/// (mid-extraction with captions already saved) instead of restarting from scratch.
fn resume_plan(job: &CollectJob) -> ResumePlan {
    let resumable = job.status == CollectJobStatus::Extracting.as_str()
        && job.caption_text.is_some()
        && job.video_id.is_some()
        && job.title.is_some();
    if resumable {
        ResumePlan {
            resume_from_extract: true,
            start_chunk: job.llm_chunk_done as usize,
        }
    } else {
        ResumePlan {
            resume_from_extract: false,
            start_chunk: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(status: &str, caption: bool, done: u32) -> CollectJob {
        CollectJob {
            id: "cjob_test".to_string(),
            url: "https://www.youtube.com/watch?v=test".to_string(),
            proxy: None,
            status: status.to_string(),
            step: "extracting 7/19".to_string(),
            error: None,
            video_id: Some("test".to_string()),
            title: Some("Test Video".to_string()),
            language: Some("en".to_string()),
            source_url: None,
            caption_text: caption.then(|| "caption".to_string()),
            draft_cards: Vec::new(),
            truncated: false,
            cancel_requested: false,
            created_at: "2026-08-01T00:00:00Z".to_string(),
            updated_at: "2026-08-01T00:00:00Z".to_string(),
            started_at: Some("2026-08-01T00:00:00Z".to_string()),
            finished_at: None,
            llm_started_at: Some("2026-08-01T00:00:00Z".to_string()),
            llm_chunk_done: done,
            llm_chunk_total: 19,
        }
    }

    #[test]
    fn extracting_job_with_stored_caption_resumes_from_done_chunk() {
        let plan = resume_plan(&job(
            CollectJobStatus::Extracting.as_str(),
            true,
            7,
        ));

        assert!(plan.resume_from_extract);
        assert_eq!(plan.start_chunk, 7);
    }

    #[test]
    fn extracting_job_without_stored_caption_restarts_from_scratch() {
        let plan = resume_plan(&job(
            CollectJobStatus::Extracting.as_str(),
            false,
            7,
        ));

        assert!(!plan.resume_from_extract);
        assert_eq!(plan.start_chunk, 0);
    }

    #[test]
    fn fetching_job_does_not_resume_extraction() {
        let plan = resume_plan(&job(
            CollectJobStatus::FetchingCaptions.as_str(),
            true,
            0,
        ));

        assert!(!plan.resume_from_extract);
        assert_eq!(plan.start_chunk, 0);
    }
}

fn app_error_message(err: &AppError) -> String {
    match err {
        AppError::Unauthorized(m)
        | AppError::BadRequest(m)
        | AppError::NotFound(m)
        | AppError::Internal(m)
        | AppError::ServiceUnavailable(m) => m.clone(),
        AppError::ImportFailed(_) => "import failed".into(),
        AppError::Repository(e) => e.to_string(),
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
