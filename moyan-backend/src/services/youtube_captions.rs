//! Fetch YouTube captions via yt-dlp and normalize VTT/SRT to plain text.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::fs;
use tokio::process::Command;
use tokio::time::timeout;

use crate::middleware::error::AppError;
use crate::models::YoutubeCaptionsResponse;

pub fn parse_youtube_video_id(url: &str) -> Result<String, AppError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("YouTube URL is required".into()));
    }

    // youtu.be/<id>
    if let Some(rest) = url.strip_prefix("https://youtu.be/")
        .or_else(|| url.strip_prefix("http://youtu.be/"))
    {
        let id = rest.split(['?', '&', '/']).next().unwrap_or("").trim();
        if is_video_id(id) {
            return Ok(id.to_string());
        }
    }

    // youtube.com/watch?v=<id>
    if let Some(idx) = url.find('?') {
        let query = &url[idx + 1..];
        for pair in query.split('&') {
            let mut parts = pair.splitn(2, '=');
            if parts.next() == Some("v") {
                if let Some(id) = parts.next() {
                    let id = id.trim();
                    if is_video_id(id) {
                        return Ok(id.to_string());
                    }
                }
            }
        }
    }

    // youtube.com/embed/<id> or /shorts/<id>
    for marker in ["/embed/", "/shorts/", "/live/"] {
        if let Some(pos) = url.find(marker) {
            let rest = &url[pos + marker.len()..];
            let id = rest.split(['?', '&', '/']).next().unwrap_or("").trim();
            if is_video_id(id) {
                return Ok(id.to_string());
            }
        }
    }

    Err(AppError::BadRequest("Invalid YouTube URL".into()))
}

fn is_video_id(id: &str) -> bool {
    id.len() >= 6
        && id.len() <= 20
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn strip_vtt(content: &str) -> String {
    let mut out = String::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("WEBVTT")
            || line.starts_with("NOTE")
            || line.starts_with("Kind:")
            || line.starts_with("Language:")
            || line.contains("-->")
            || line.chars().all(|c| c.is_ascii_digit())
        {
            continue;
        }
        let cleaned = strip_html_tags(line);
        if !cleaned.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(&cleaned);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ytdlp_bin() -> String {
    std::env::var("MOYAN_YTDLP_PATH").unwrap_or_else(|_| "yt-dlp".to_string())
}

pub async fn fetch_youtube_captions(
    url: &str,
    proxy: Option<&str>,
) -> Result<YoutubeCaptionsResponse, AppError> {
    let video_id = parse_youtube_video_id(url)?;
    let source_url = format!("https://www.youtube.com/watch?v={video_id}");

    if stub_enabled() {
        return Ok(stub_captions(&video_id, &source_url));
    }

    let bin = ytdlp_bin();
    let proxy = normalize_proxy(proxy);

    let tmp = tempfile_dir(&video_id).await?;
    let outtmpl = tmp.join("%(id)s.%(ext)s");

    let meta = run_ytdlp_meta(&bin, &source_url, proxy.as_deref()).await?;
    run_ytdlp_subs(&bin, &source_url, &outtmpl, proxy.as_deref()).await?;

    let (language, caption_path) = find_caption_file(&tmp, &video_id).await?;
    let raw = fs::read_to_string(&caption_path)
        .await
        .map_err(|e| AppError::Internal(format!("read caption file: {e}")))?;
    let caption_text = strip_vtt(&raw);
    if caption_text.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Video has no usable captions/subtitles".into(),
        ));
    }

    let _ = fs::remove_dir_all(&tmp).await;

    Ok(YoutubeCaptionsResponse {
        video_id,
        title: meta.title,
        duration_sec: meta.duration_sec,
        language,
        caption_text,
        source_url,
    })
}

pub fn normalize_proxy(proxy: Option<&str>) -> Option<String> {
    let from_req = proxy
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if from_req.is_some() {
        return from_req;
    }
    std::env::var("MOYAN_YTDLP_PROXY")
        .or_else(|_| std::env::var("HTTPS_PROXY"))
        .or_else(|_| std::env::var("https_proxy"))
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .or_else(|_| std::env::var("http_proxy"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn stub_enabled() -> bool {
    matches!(
        std::env::var("MOYAN_COLLECT_STUB").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

fn stub_captions(video_id: &str, source_url: &str) -> YoutubeCaptionsResponse {
    YoutubeCaptionsResponse {
        video_id: video_id.to_string(),
        title: format!("Stub title for {video_id}"),
        duration_sec: Some(120),
        language: "en".into(),
        caption_text: "Hello everyone and welcome to this English lesson. Today we discuss persistence, resilience, and curiosity. Consistency compounds over time. Words like endeavor, meticulous, and eloquent elevate expression. Practice pronunciation and review examples daily.".into(),
        source_url: source_url.to_string(),
    }
}

struct YtMeta {
    title: String,
    duration_sec: Option<i64>,
}

async fn tempfile_dir(video_id: &str) -> Result<PathBuf, AppError> {
    let dir = std::env::temp_dir().join(format!("moyan-yt-{video_id}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("temp dir: {e}")))?;
    Ok(dir)
}

async fn run_ytdlp_meta(bin: &str, url: &str, proxy: Option<&str>) -> Result<YtMeta, AppError> {
    let mut cmd = Command::new(bin);
    cmd.args([
        "--skip-download",
        "--no-warnings",
        "--print",
        "%(title)s\n%(duration)s",
        url,
    ]);
    apply_proxy_args(&mut cmd, proxy);
    let output = timeout(Duration::from_secs(90), cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output())
    .await
    .map_err(|_| AppError::BadRequest("yt-dlp timed out while fetching metadata".into()))?
    .map_err(|e| AppError::Internal(format!("failed to spawn yt-dlp: {e}")))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::BadRequest(format!(
            "yt-dlp metadata failed: {}",
            err.lines().last().unwrap_or("unknown error")
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines().map(str::trim).filter(|l| !l.is_empty());
    let title = lines
        .next()
        .unwrap_or("YouTube Video")
        .to_string();
    let duration_sec = lines.next().and_then(|s| s.parse::<i64>().ok());
    Ok(YtMeta {
        title,
        duration_sec,
    })
}

fn apply_proxy_args(cmd: &mut Command, proxy: Option<&str>) {
    if let Some(proxy) = proxy.map(str::trim).filter(|value| !value.is_empty()) {
        cmd.args(["--proxy", proxy]);
    }
}

async fn run_ytdlp_subs(
    bin: &str,
    url: &str,
    outtmpl: &PathBuf,
    proxy: Option<&str>,
) -> Result<(), AppError> {
    // Prefer the android player client path that works reliably with proxies.
    run_ytdlp_subs_plain(bin, url, outtmpl, proxy).await
}

async fn run_ytdlp_subs_plain(
    bin: &str,
    url: &str,
    outtmpl: &PathBuf,
    proxy: Option<&str>,
) -> Result<(), AppError> {
    let mut cmd = Command::new(bin);
    cmd.args([
        "--skip-download",
        "--write-auto-sub",
        "--sub-langs",
        "en",
        "--sub-format",
        "vtt/best",
        "--extractor-args",
        "youtube:player_client=android",
        "--sleep-interval",
        "2",
        "-o",
        outtmpl.to_str().unwrap_or("%(id)s"),
        url,
    ]);
    apply_proxy_args(&mut cmd, proxy);
    let output = timeout(
        Duration::from_secs(180),
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output(),
    )
    .await
    .map_err(|_| AppError::BadRequest("yt-dlp timed out while fetching captions".into()))?
    .map_err(|e| AppError::Internal(format!("failed to spawn yt-dlp: {e}")))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::BadRequest(format!(
            "yt-dlp captions failed: {}",
            err.lines().last().unwrap_or("unknown error")
        )));
    }
    Ok(())
}

async fn find_caption_file(dir: &PathBuf, video_id: &str) -> Result<(String, PathBuf), AppError> {
    let mut entries = fs::read_dir(dir)
        .await
        .map_err(|e| AppError::Internal(format!("list caption dir: {e}")))?;

    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("read caption dir: {e}")))?
    {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if !(name.ends_with(".vtt") || name.ends_with(".srt")) {
            continue;
        }
        if !name.starts_with(video_id) {
            continue;
        }
        let lang = name
            .trim_start_matches(video_id)
            .trim_start_matches('.')
            .trim_end_matches(".vtt")
            .trim_end_matches(".srt")
            .to_string();
        candidates.push((lang, path));
    }

    if candidates.is_empty() {
        return Err(AppError::BadRequest(
            "No English captions found for this video".into(),
        ));
    }

    candidates.sort_by(|a, b| preference_rank(&a.0).cmp(&preference_rank(&b.0)));
    let (lang, path) = candidates.into_iter().next().unwrap();
    Ok((if lang.is_empty() { "und".into() } else { lang }, path))
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn preference_rank(lang: &str) -> u8 {
    let l = lang.to_ascii_lowercase();
    if l == "en" {
        0
    } else if l.starts_with("en") {
        1
    } else {
        10
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_watch_and_short_urls() {
        assert_eq!(
            parse_youtube_video_id("https://www.youtube.com/watch?v=LqG1q5NpOBE").unwrap(),
            "LqG1q5NpOBE"
        );
        assert_eq!(
            parse_youtube_video_id("https://youtu.be/LqG1q5NpOBE?t=10").unwrap(),
            "LqG1q5NpOBE"
        );
    }

    #[test]
    fn strips_vtt_timestamps() {
        let vtt = r#"WEBVTT

00:00:00.000 --> 00:00:02.000
Hello <c>world</c>

00:00:02.000 --> 00:00:04.000
from YouTube
"#;
        assert_eq!(strip_vtt(vtt), "Hello world from YouTube");
    }
}
