use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimedCaption {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodcastResolveResponse {
    pub video_id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_sec: Option<i64>,
    pub thumbnail: Option<String>,
    pub audio_url: String,
    pub captions: Vec<TimedCaption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodcastTranslateResponse {
    pub video_id: String,
    pub translations: Vec<String>,
    #[serde(default)]
    pub caption_hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodcastConfig {
    pub app_enabled: bool,
    pub web_enabled: bool,
    pub youtube_api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfigResponse {
    pub podcast: PodcastConfig,
}
