//! Podcast module: light resolve + per-video cached audio & timed captions.
use std::path::PathBuf;
use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{
    AppConfigResponse, LlmSettingsStored, PodcastConfig, PodcastResolveResponse,
    PodcastTranslateResponse, TimedCaption,
};
use crate::repositories::Repository;
use crate::services::llm_client;
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

        if let Some(mut cached) = read_cached(&cache, &video_id).await? {
            cached.captions = split_long_captions(dedupe_captions(cached.captions), MAX_SUBTITLE_CHARS);
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
            captions: split_long_captions(dedupe_captions(captions), MAX_SUBTITLE_CHARS),
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

    /// Translate cached subtitle lines into Chinese. The translation is cached
    /// per video so only the first request pays the LLM cost.
    pub async fn translate(
        &self,
        video_id: &str,
        settings: &LlmSettingsStored,
    ) -> Result<PodcastTranslateResponse, AppError> {
        if !is_valid_video_id(video_id) {
            return Err(AppError::BadRequest("invalid video id".into()));
        }
        let cache = cache_dir();
        let zh_path = cache.join(format!("{video_id}.zh.json"));
        let mut resolved = read_cached(&cache, video_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Resolve the video first".into()))?;
        resolved.captions =
            split_long_captions(dedupe_captions(resolved.captions), MAX_SUBTITLE_CHARS);
        let caption_hash = caption_hash(&resolved.captions);
        if zh_path.exists() {
            let raw = tokio::fs::read_to_string(&zh_path)
                .await
                .map_err(|e| AppError::Internal(format!("read translation cache: {e}")))?;
            if let Ok(resp) = serde_json::from_str::<PodcastTranslateResponse>(&raw) {
                if resp.caption_hash == caption_hash {
                    return Ok(resp);
                }
            }
        }

        let lines: Vec<String> = resolved.captions.iter().map(|c| c.text.clone()).collect();
        let llm_proxy = std::env::var("MOYAN_LLM_PROXY").ok();
        let translations =
            llm_client::translate_caption_lines(settings, video_id, &resolved.title, &lines, llm_proxy.as_deref())
                .await?;
        let resp = PodcastTranslateResponse {
            video_id: video_id.to_string(),
            translations,
            caption_hash,
        };
        let json = serde_json::to_vec(&resp)
            .map_err(|e| AppError::Internal(format!("serialize translation: {e}")))?;
        tokio::fs::write(&zh_path, json)
            .await
            .map_err(|e| AppError::Internal(format!("write translation cache: {e}")))?;
        Ok(resp)
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

/// FNV-1a fingerprint of the caption list so stale translation caches (from
/// before subtitle dedupe/merging) can be detected and regenerated.
fn caption_hash(captions: &[TimedCaption]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for cap in captions {
        for byte in cap.text.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
        hash ^= cap.start_ms as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
        hash ^= cap.end_ms as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

const MAX_SUBTITLE_CHARS: usize = 260;

/// Merge YouTube auto-caption rolling duplicates. Auto-captions repeat the
/// same words across consecutive entries: either an exact duplicate, a
/// progressive superset ("ABC", "ABC DEF"), or a tail-only subset
/// ("ABC DEF", "DEF"). Only whole-text comparisons are used (no character
/// slicing), so merged lines never contain artifacts.
fn dedupe_captions(captions: Vec<TimedCaption>) -> Vec<TimedCaption> {
    fn norm_word(w: &str) -> String {
        w.chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .flat_map(|ch| ch.to_lowercase())
            .collect()
    }

    let mut out: Vec<TimedCaption> = Vec::new();
    for cap in captions {
        if let Some(prev) = out.last_mut() {
            let prev_words: Vec<&str> = prev.text.split_whitespace().collect();
            let cur_words: Vec<&str> = cap.text.split_whitespace().collect();
            if cur_words.is_empty() {
                continue;
            }
            let prev_norm: Vec<String> =
                prev_words.iter().map(|w| norm_word(w)).collect();
            let cur_norm: Vec<String> =
                cur_words.iter().map(|w| norm_word(w)).collect();

            // identical or progressive superset: "ABC", "ABC DEF"
            if cur_norm.len() >= prev_norm.len()
                && cur_norm[..prev_norm.len()] == prev_norm[..]
            {
                prev.text = cap.text.clone();
                prev.end_ms = cap.end_ms;
                continue;
            }

            // tail-only or inner repeat: "ABC DEF", "DEF"
            if prev_norm.len() >= cur_norm.len()
                && (prev_norm.ends_with(&cur_norm[..])
                    || prev_norm
                        .windows(cur_norm.len())
                        .any(|w| w == &cur_norm[..]))
            {
                prev.end_ms = cap.end_ms;
                continue;
            }

            // rolling overlap: prev ends with the first L words of cur.
            // Word boundaries make the merge artifact-free.
            let min_len = prev_norm.len().min(cur_norm.len());
            let mut overlap = 0usize;
            for l in (1..=min_len).rev() {
                if prev_norm[prev_norm.len() - l..] == cur_norm[..l] {
                    overlap = l;
                    break;
                }
            }
            if overlap >= 2 && overlap as f64 >= min_len as f64 * 0.35 {
                let tail = cur_words[overlap..].join(" ");
                prev.text = format!("{} {}", prev.text.trim_end(), tail.trim_start());
                prev.end_ms = cap.end_ms;
                continue;
            }
        }
        out.push(cap);
    }
    out
}

/// Split merged auto-caption paragraphs into sentence-aligned chunks of at
/// most `max_chars`, distributing the original time range proportionally so
/// tapping a line still jumps to roughly the right position.
fn split_long_captions(captions: Vec<TimedCaption>, max_chars: usize) -> Vec<TimedCaption> {
    fn sentences(text: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut current = String::new();
        for ch in text.chars() {
            current.push(ch);
            if matches!(ch, '.' | '?' | '!') {
                out.push(std::mem::take(&mut current));
            }
        }
        if !current.trim().is_empty() {
            out.push(current);
        }
        out
    }

    let mut out = Vec::new();
    for cap in captions {
        if cap.text.chars().count() <= max_chars {
            out.push(cap);
            continue;
        }
        let mut chunks: Vec<String> = Vec::new();
        let mut current = String::new();
        for sentence in sentences(&cap.text) {
            if !current.is_empty() && current.chars().count() + sentence.chars().count() > max_chars {
                chunks.push(std::mem::take(&mut current));
            }
            current.push_str(&sentence);
        }
        if !current.trim().is_empty() {
            chunks.push(current);
        }
        if chunks.len() <= 1 {
            out.push(cap);
            continue;
        }
        let span = cap.end_ms - cap.start_ms;
        let total: usize = chunks.iter().map(|c| c.chars().count()).sum();
        let mut start = cap.start_ms;
        for (i, chunk) in chunks.iter().enumerate() {
            let frac = chunk.chars().count() as f64 / total as f64;
            let end = if i == chunks.len() - 1 {
                cap.end_ms
            } else {
                start + (span as f64 * frac) as i64
            };
            out.push(TimedCaption {
                start_ms: start,
                end_ms: end,
                text: chunk.trim().to_string(),
            });
            start = end;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cap(start: i64, end: i64, text: &str) -> TimedCaption {
        TimedCaption {
            start_ms: start,
            end_ms: end,
            text: text.to_string(),
        }
    }

    #[test]
    fn dedupes_identical_consecutive_lines() {
        let out = dedupe_captions(vec![
            cap(0, 1000, "Hello world"),
            cap(1000, 2000, "Hello world"),
            cap(2000, 3000, "Hello world"),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Hello world");
        assert_eq!(out[0].end_ms, 3000);
    }

    #[test]
    fn folds_progressive_accumulation() {
        let out = dedupe_captions(vec![
            cap(0, 1000, "First sentence"),
            cap(1000, 2000, "First sentence second part"),
            cap(2000, 3000, "First sentence second part third"),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "First sentence second part third");
    }

    #[test]
    fn merges_tail_subset_without_artifacts() {
        let out = dedupe_captions(vec![
            cap(0, 1000, "A very long tail that repeats"),
            cap(1000, 2000, "tail that repeats"),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "A very long tail that repeats");
        assert_eq!(out[0].end_ms, 2000);
    }

    #[test]
    fn merges_rolling_word_overlap_cleanly() {
        let out = dedupe_captions(vec![
            cap(0, 1000, "first second third"),
            cap(1000, 2000, "second third fourth fifth"),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "first second third fourth fifth");
    }

    #[test]
    fn keeps_distinct_and_extension_lines() {
        let out = dedupe_captions(vec![
            cap(0, 1000, "First line here"),
            cap(1000, 2000, "Completely different line"),
            cap(2000, 3000, "tail here and continues"),
        ]);
        assert_eq!(out.len(), 3);
        assert!(out.iter().all(|c| !c.text.contains("tail here tail here")));
    }

    #[test]
    fn splits_long_lines_on_sentence_boundaries() {
        let long = format!(
            "{} {}",
            "Sentence one here with some more words.",
            "Sentence two here with even more words and detail."
        );
        let out = split_long_captions(vec![cap(0, 6000, &long)], 40);
        assert!(out.len() >= 2);
        assert!(out.iter().all(|c| c.text.chars().count() <= 60));
        assert_eq!(
            out.iter().map(|c| c.text.clone()).collect::<Vec<_>>().join(" ").replace(' ', ""),
            long.replace(' ', "")
        );
    }
}
