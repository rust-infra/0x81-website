//! Fetch YouTube captions via yt-dlp and normalize VTT/SRT to plain text.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::fs;
use tokio::process::Command;
use tokio::time::timeout;

use crate::middleware::error::AppError;
use crate::models::{TimedCaption, YoutubeCaptionsResponse};

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

/// Parse VTT/SRT content into timed caption cues.
pub fn parse_timed_captions(content: &str) -> Vec<TimedCaption> {
    let mut cues = Vec::new();
    let mut current_time: Option<(i64, i64)> = None;
    let mut current_text = String::new();

    let flush = |current_text: &mut String, current_time: &mut Option<(i64, i64)>, cues: &mut Vec<TimedCaption>| {
        if let (Some((start_ms, end_ms)), text) = (current_time.take(), current_text.trim()) {
            if !text.is_empty() {
                cues.push(TimedCaption {
                    start_ms,
                    end_ms,
                    text: text.to_string(),
                });
            }
        }
        current_text.clear();
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("WEBVTT") || line.starts_with("NOTE") {
            continue;
        }
        if let Some((start, end)) = parse_timestamp_range(line) {
            flush(&mut current_text, &mut current_time, &mut cues);
            current_time = Some((start, end));
            continue;
        }
        if line.chars().all(|c| c.is_ascii_digit()) {
            continue; // cue index
        }
        if current_time.is_some() {
            let cleaned = strip_html_tags(line);
            if !cleaned.is_empty() {
                if !current_text.is_empty() {
                    current_text.push(' ');
                }
                current_text.push_str(&cleaned);
            }
        }
    }
    flush(&mut current_text, &mut current_time, &mut cues);
    cues
}

fn parse_timestamp_range(line: &str) -> Option<(i64, i64)> {
    let arrow = line.find("-->")?;
    let start = parse_timestamp(line[..arrow].trim())?;
    let end = parse_timestamp(line[arrow + 3..].trim())?;
    Some((start, end))
}

fn parse_timestamp(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let (hms, frac) = match raw.find(['.', ',']) {
        Some(idx) => (&raw[..idx], &raw[idx + 1..]),
        None => (raw, ""),
    };
    let ms: i64 = frac
        .chars()
        .take(3)
        .collect::<String>()
        .parse::<i64>()
        .ok()
        .unwrap_or(0);
    let parts: Vec<i64> = hms
        .split(':')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let mut total = 0i64;
    for part in parts {
        total = total * 60 + part;
    }
    Some(total * 1000 + ms)
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
        channel: meta.channel,
        thumbnail: meta.thumbnail,
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
        channel: Some("Stub Channel".into()),
        thumbnail: Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")),
        language: "en".into(),
        caption_text: "Hello everyone and welcome to this English lesson. Today we discuss persistence, resilience, and curiosity. Consistency compounds over time. Words like endeavor, meticulous, and eloquent elevate expression. Practice pronunciation and review examples daily.".into(),
        source_url: source_url.to_string(),
    }
}

pub struct YtMeta {
    pub title: String,
    pub duration_sec: Option<i64>,
    pub channel: Option<String>,
    pub thumbnail: Option<String>,
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
        "%(title)s\n%(duration)s\n%(channel)s\n%(thumbnail)s",
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
    let channel = lines.next().map(str::to_string).filter(|s| !s.is_empty());
    let thumbnail = lines.next().map(str::to_string).filter(|s| !s.is_empty());
    Ok(YtMeta {
        title,
        duration_sec,
        channel,
        thumbnail,
    })
}

/// Fetch metadata + timed captions for a podcast video.
pub async fn fetch_podcast_payload(
    url: &str,
    proxy: Option<&str>,
) -> Result<(String, YtMeta, Vec<TimedCaption>), AppError> {
    let video_id = parse_youtube_video_id(url)?;
    let source_url = format!("https://www.youtube.com/watch?v={video_id}");

    if stub_enabled() {
        let meta = YtMeta {
            title: format!("Stub title for {video_id}"),
            duration_sec: Some(120),
            channel: Some("Stub Channel".into()),
            thumbnail: Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")),
        };
        let captions = vec![
            TimedCaption { start_ms: 0, end_ms: 3000, text: "Hello everyone and welcome to this English lesson.".into() },
            TimedCaption { start_ms: 3000, end_ms: 7000, text: "Today we discuss persistence, resilience, and curiosity.".into() },
            TimedCaption { start_ms: 7000, end_ms: 11000, text: "Consistency compounds over time.".into() },
        ];
        return Ok((video_id, meta, captions));
    }

    let bin = ytdlp_bin();
    let proxy = normalize_proxy(proxy);
    let tmp = tempfile_dir(&video_id).await?;
    let outtmpl = tmp.join("%(id)s.%(ext)s");

    let meta = run_ytdlp_meta(&bin, &source_url, proxy.as_deref()).await?;
    run_ytdlp_subs(&bin, &source_url, &outtmpl, proxy.as_deref()).await?;
    let (_language, caption_path) = find_caption_file(&tmp, &video_id).await?;
    let raw = fs::read_to_string(&caption_path)
        .await
        .map_err(|e| AppError::Internal(format!("read caption file: {e}")))?;
    let captions = parse_timed_captions(&raw);
    if captions.is_empty() {
        return Err(AppError::BadRequest(
            "Video has no usable captions/subtitles".into(),
        ));
    }
    let _ = fs::remove_dir_all(&tmp).await;
    Ok((video_id, meta, captions))
}

/// Download the audio track (mp3) for a video into a temp dir; returns the file path.
pub async fn download_podcast_audio(
    video_id: &str,
    proxy: Option<&str>,
) -> Result<PathBuf, AppError> {
    let source_url = format!("https://www.youtube.com/watch?v={video_id}");
    if stub_enabled() {
        let dir = tempfile_dir(video_id).await?;
        let path = dir.join(format!("{video_id}.mp3"));
        fs::write(&path, b"stub-audio")
            .await
            .map_err(|e| AppError::Internal(format!("write stub audio: {e}")))?;
        return Ok(path);
    }

    let bin = ytdlp_bin();
    let proxy = normalize_proxy(proxy);
    let tmp = tempfile_dir(video_id).await?;
    let outtmpl = tmp.join("%(id)s.%(ext)s");
    let mut cmd = Command::new(bin);
    cmd.args([
        "-f",
        "bestaudio",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--no-playlist",
        "-o",
        outtmpl.to_str().unwrap_or("%(id)s.%(ext)s"),
        &source_url,
    ]);
    apply_proxy_args(&mut cmd, proxy.as_deref());
    let output = timeout(
        Duration::from_secs(300),
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output(),
    )
    .await
    .map_err(|_| AppError::BadRequest("yt-dlp timed out while fetching audio".into()))?
    .map_err(|e| AppError::Internal(format!("failed to spawn yt-dlp: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::BadRequest(format!(
            "yt-dlp audio failed: {}",
            err.lines().last().unwrap_or("unknown error")
        )));
    }

    let mut entries = fs::read_dir(&tmp)
        .await
        .map_err(|e| AppError::Internal(format!("list audio dir: {e}")))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("read audio dir: {e}")))?
    {
        let path = entry.path();
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.starts_with(video_id)
            && [".mp3", ".m4a", ".webm", ".opus", ".ogg"]
                .iter()
                .any(|ext| name.ends_with(ext))
        {
            return Ok(path);
        }
    }
    let _ = fs::remove_dir_all(&tmp).await;
    Err(AppError::BadRequest(
        "yt-dlp produced no audio file".into(),
    ))
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

    #[test]
    fn parses_vtt_into_timed_cues() {
        let vtt = r#"WEBVTT

00:00:00.000 --> 00:00:02.000
Hello <c>world</c>

00:00:02.500 --> 00:00:04.000
from YouTube
"#;
        let cues = parse_timed_captions(vtt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 0);
        assert_eq!(cues[0].end_ms, 2000);
        assert_eq!(cues[0].text, "Hello world");
        assert_eq!(cues[1].start_ms, 2500);
        assert_eq!(cues[1].end_ms, 4000);
        assert_eq!(cues[1].text, "from YouTube");
    }

    #[test]
    fn parses_srt_comma_timestamps() {
        let srt = "1\n00:00:01,200 --> 00:00:03,400\n你好\n\n2\n00:00:03,500 --> 00:00:05,000\n世界\n";
        let cues = parse_timed_captions(srt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 1200);
        assert_eq!(cues[0].end_ms, 3400);
        assert_eq!(cues[1].text, "世界");
    }
}
