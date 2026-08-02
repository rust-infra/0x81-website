use serde::{Deserialize, Serialize};

use crate::models::{CardExampleInput, CreateCardRequest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSettingsStored {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_temperature() -> f32 {
    0.3
}

impl Default for LlmSettingsStored {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            temperature: default_temperature(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmSettingsPublic {
    pub base_url: String,
    pub model: String,
    pub temperature: f32,
    pub api_key_set: bool,
    pub api_key_masked: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateLlmSettingsRequest {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    #[serde(default)]
    pub clear_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YoutubeCaptionsRequest {
    pub url: String,
    /// Optional HTTP(S) proxy for yt-dlp, e.g. `http://127.0.0.1:7890`
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct YoutubeCaptionsResponse {
    pub video_id: String,
    pub title: String,
    pub duration_sec: Option<i64>,
    pub channel: Option<String>,
    pub thumbnail: Option<String>,
    pub language: String,
    pub caption_text: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YoutubeExtractRequest {
    pub video_id: String,
    pub title: String,
    pub caption_text: String,
    /// Optional HTTP(S) proxy for LLM outbound requests
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftCard {
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub examples: Vec<CardExampleInput>,
}

impl DraftCard {
    pub fn into_create_request(self) -> CreateCardRequest {
        CreateCardRequest {
            front: self.front,
            back: self.back,
            pronunciation: self.pronunciation,
            tags: if self.tags.is_empty() {
                None
            } else {
                Some(self.tags)
            },
            examples: if self.examples.is_empty() {
                None
            } else {
                Some(self.examples)
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct YoutubeExtractResponse {
    pub draft_cards: Vec<DraftCard>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum CollectImportTarget {
    Create {
        name: String,
        description: Option<String>,
        source_key: Option<String>,
    },
    Merge {
        deck_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct YoutubeImportRequest {
    pub target: CollectImportTarget,
    pub cards: Vec<DraftCard>,
}

#[derive(Debug, Clone, Serialize)]
pub struct YoutubeImportResponse {
    pub deck_id: String,
    pub created_cards: usize,
    pub skipped_cards: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectJobStatus {
    Queued,
    FetchingCaptions,
    Extracting,
    Ready,
    Failed,
    Paused,
}

impl CollectJobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::FetchingCaptions => "fetching_captions",
            Self::Extracting => "extracting",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Paused => "paused",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "fetching_captions" => Some(Self::FetchingCaptions),
            "extracting" => Some(Self::Extracting),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            "paused" => Some(Self::Paused),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Ready | Self::Failed | Self::Paused)
    }

    pub fn is_running(&self) -> bool {
        matches!(
            self,
            Self::Queued | Self::FetchingCaptions | Self::Extracting
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectJob {
    pub id: String,
    pub url: String,
    pub proxy: Option<String>,
    pub status: String,
    pub step: String,
    pub error: Option<String>,
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub source_url: Option<String>,
    pub caption_text: Option<String>,
    pub draft_cards: Vec<DraftCard>,
    pub truncated: bool,
    pub cancel_requested: bool,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// When LLM extract phase began (RFC3339).
    #[serde(default)]
    pub llm_started_at: Option<String>,
    /// Caption chunks completed by LLM so far.
    #[serde(default)]
    pub llm_chunk_done: u32,
    /// Total caption chunks for this job.
    #[serde(default)]
    pub llm_chunk_total: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCollectJobRequest {
    pub url: String,
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CollectJobListQuery {
    pub q: Option<String>,
    pub status: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

impl CollectJobListQuery {
    pub fn page(&self) -> u32 {
        self.page.unwrap_or(1).max(1)
    }

    pub fn page_size(&self) -> u32 {
        self.page_size.unwrap_or(20).clamp(1, 100)
    }

    pub fn offset(&self) -> i64 {
        ((self.page() - 1) * self.page_size()) as i64
    }
}

/// List payload omits heavy caption text; draft cards kept for ready preview convenience.
#[derive(Debug, Clone, Serialize)]
pub struct CollectJobListItem {
    pub id: String,
    pub url: String,
    pub proxy: Option<String>,
    pub status: String,
    pub step: String,
    pub error: Option<String>,
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub source_url: Option<String>,
    pub draft_card_count: usize,
    pub truncated: bool,
    pub cancel_requested: bool,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[serde(default)]
    pub llm_started_at: Option<String>,
    #[serde(default)]
    pub llm_chunk_done: u32,
    #[serde(default)]
    pub llm_chunk_total: u32,
}

impl From<&CollectJob> for CollectJobListItem {
    fn from(job: &CollectJob) -> Self {
        Self {
            id: job.id.clone(),
            url: job.url.clone(),
            proxy: job.proxy.clone(),
            status: job.status.clone(),
            step: job.step.clone(),
            error: job.error.clone(),
            video_id: job.video_id.clone(),
            title: job.title.clone(),
            language: job.language.clone(),
            source_url: job.source_url.clone(),
            draft_card_count: job.draft_cards.len(),
            truncated: job.truncated,
            cancel_requested: job.cancel_requested,
            created_at: job.created_at.clone(),
            updated_at: job.updated_at.clone(),
            started_at: job.started_at.clone(),
            finished_at: job.finished_at.clone(),
            llm_started_at: job.llm_started_at.clone(),
            llm_chunk_done: job.llm_chunk_done,
            llm_chunk_total: job.llm_chunk_total,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectJobListResponse {
    pub items: Vec<CollectJobListItem>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

pub fn mask_api_key(key: &str) -> Option<String> {
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    if key.len() <= 8 {
        return Some("***".to_string());
    }
    let prefix: String = key.chars().take(3).collect();
    let suffix: String = key.chars().rev().take(4).collect::<String>().chars().rev().collect();
    Some(format!("{prefix}***{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_api_key() {
        assert_eq!(mask_api_key(""), None);
        assert_eq!(mask_api_key("sk-abcdefghijklmnop").as_deref(), Some("sk-***mnop"));
    }
}
