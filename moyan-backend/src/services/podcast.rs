//! Podcast module: light resolve + per-video cached audio & timed captions.
use std::path::PathBuf;
use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{AppConfigResponse, PodcastConfig, PodcastResolveResponse};
use crate::repositories::Repository;
use crate::services::youtube_captions::{
    download_podcast_audio, fetch_podcast_payload, normalize_proxy, parse_youtube_video_id,
};

const FEATURE_PODCAST_ENABLED: &str = "feature_podcast_enabled";
const YOUTUBE_API_KEY: &str = "youtube_api_key";

#[derive(Clone)]
pub struct PodcastService {
    repository: Arc<dyn Repository>,
}

impl PodcastService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    /// Public app config: whether the podcast entry is shown + the YouTube search key.
    pub async fn config(&self) -> Result<AppConfigResponse, AppError> {
        let enabled = self
            .repository
            .admin_get_setting(FEATURE_PODCAST_ENABLED)
            .await?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let youtube_api_key = self
            .repository
            .admin_get_setting(YOUTUBE_API_KEY)
            .await?
            .unwrap_or_default();
        Ok(AppConfigResponse {
            podcast: PodcastConfig {
                enabled,
                youtube_api_key,
            },
        })
    }

    /// Admin: toggle the podcast entry and set the YouTube search key.
    pub async fn set_config(
        &self,
        enabled: bool,
        youtube_api_key: &str,
    ) -> Result<AppConfigResponse, AppError> {
        self.repository
            .admin_put_setting(FEATURE_PODCAST_ENABLED, if enabled { "1" } else { "0" })
            .await?;
        self.repository
            .admin_put_setting(YOUTUBE_API_KEY, youtube_api_key)
            .await?;
        self.config().await
    }

    /// Resolve a video: heavy work (yt-dlp audio + timed captions) runs once per
    /// video and is cached; subsequent calls hit the cache.
    pub async fn resolve(&self, url: &str) -> Result<PodcastResolveResponse, AppError> {
        let video_id = parse_youtube_video_id(url)?;
        let cache = cache_dir();
        std::fs::create_dir_all(&cache)
            .map_err(|e| AppError::Internal(format!("podcast cache dir: {e}")))?;

        if let Some(cached) = read_cached(&cache, &video_id).await? {
            return Ok(cached);
        }

        let proxy = normalize_proxy(None);
        let (vid, meta, captions) = fetch_podcast_payload(url, proxy.as_deref()).await?;
        let tmp_audio = download_podcast_audio(&vid, proxy.as_deref()).await?;
        let ext = tmp_audio
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp3");
        let audio_path = cache.join(format!("{video_id}.{ext}"));
        std::fs::rename(&tmp_audio, &audio_path)
            .map_err(|e| AppError::Internal(format!("move audio: {e}")))?;
        if let Some(parent) = tmp_audio.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }

        let resp = PodcastResolveResponse {
            video_id: vid,
            title: meta.title,
            channel: meta.channel,
            duration_sec: meta.duration_sec,
            thumbnail: meta.thumbnail,
            audio_url: format!("/api/podcast/audio/{video_id}"),
            captions,
        };
        let json = serde_json::to_vec(&resp)
            .map_err(|e| AppError::Internal(format!("serialize podcast: {e}")))?;
        std::fs::write(cache.join(format!("{video_id}.json")), json)
            .map_err(|e| AppError::Internal(format!("write podcast cache: {e}")))?;
        Ok(resp)
    }

    /// Locate the cached audio file for a video.
    pub async fn audio_path(&self, video_id: &str) -> Result<PathBuf, AppError> {
        if !is_valid_video_id(video_id) {
            return Err(AppError::BadRequest("invalid video id".into()));
        }
        let cache = cache_dir();
        for ext in ["mp3", "m4a", "webm", "opus", "ogg"] {
            let path = cache.join(format!("{video_id}.{ext}"));
            if path.exists() {
                return Ok(path);
            }
        }
        Err(AppError::NotFound(
            "Audio not found; resolve the video first".into(),
        ))
    }
}

async fn read_cached(
    cache: &PathBuf,
    video_id: &str,
) -> Result<Option<PodcastResolveResponse>, AppError> {
    let json_path = cache.join(format!("{video_id}.json"));
    if !json_path.exists() {
        return Ok(None);
    }
    let has_audio = ["mp3", "m4a", "webm", "opus", "ogg"]
        .iter()
        .any(|ext| cache.join(format!("{video_id}.{ext}")).exists());
    if !has_audio {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&json_path)
        .await
        .map_err(|e| AppError::Internal(format!("read podcast cache: {e}")))?;
    let resp = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("parse podcast cache: {e}")))?;
    Ok(Some(resp))
}

fn cache_dir() -> PathBuf {
    std::env::var("PODCAST_CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data/podcast"))
}

fn is_valid_video_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
