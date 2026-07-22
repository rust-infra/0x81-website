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
