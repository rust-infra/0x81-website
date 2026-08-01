//! OpenAI-compatible chat completions client for vocabulary extraction.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::middleware::error::AppError;
use crate::models::{CardExampleInput, DraftCard, LlmSettingsStored};

/// Per-request caption window for LLM context. Full transcript is covered by
/// as many overlapping chunks as needed (no chunk/card count caps).
/// Keep windows moderate so proxy-buffered LLM responses stay reliable.
const CHUNK_CHARS: usize = 4_000;
const CHUNK_OVERLAP: usize = 200;

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: Option<MessageContent>,
    /// Some reasoning models put text here instead of `content`.
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Deserialize)]
struct ContentPart {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    #[serde(rename = "type")]
    kind: Option<String>,
}

impl ChatMessage {
    fn text(&self) -> Option<String> {
        if let Some(content) = &self.content {
            match content {
                MessageContent::Text(s) if !s.trim().is_empty() => return Some(s.clone()),
                MessageContent::Parts(parts) => {
                    let joined: String = parts
                        .iter()
                        .filter_map(|p| p.text.as_deref())
                        .collect::<Vec<_>>()
                        .join("");
                    if !joined.trim().is_empty() {
                        return Some(joined);
                    }
                }
                MessageContent::Text(_) => {}
            }
        }
        self.reasoning_content
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmCard {
    front: String,
    back: String,
    #[serde(default)]
    pronunciation: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    examples: Vec<LlmExample>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmExample {
    sentence_en: String,
    translation_zh: String,
}

#[derive(Debug, Deserialize)]
struct LlmPayload {
    cards: Vec<LlmCard>,
}

pub struct ExtractOutcome {
    pub draft_cards: Vec<DraftCard>,
    pub truncated: bool,
}

pub async fn extract_vocabulary_cards(
    settings: &LlmSettingsStored,
    video_id: &str,
    title: &str,
    caption_text: &str,
    proxy: Option<&str>,
) -> Result<ExtractOutcome, AppError> {
    extract_vocabulary_cards_with_progress(
        settings,
        video_id,
        title,
        caption_text,
        proxy,
        0,
        &[],
        |_cards, _done, _total| async { Ok(()) },
    )
    .await
}

pub async fn extract_vocabulary_cards_with_progress<F, Fut>(
    settings: &LlmSettingsStored,
    video_id: &str,
    title: &str,
    caption_text: &str,
    proxy: Option<&str>,
    start_chunk: usize,
    initial_cards: &[DraftCard],
    mut on_progress: F,
) -> Result<ExtractOutcome, AppError>
where
    F: FnMut(&[DraftCard], usize, usize) -> Fut,
    Fut: std::future::Future<Output = Result<(), AppError>>,
{
    if settings.base_url.trim().is_empty() || settings.model.trim().is_empty() {
        return Err(AppError::BadRequest(
            "请先在设置中配置 LLM base_url 与 model".into(),
        ));
    }
    if settings.api_key.trim().is_empty() {
        return Err(AppError::BadRequest(
            "请先在设置中配置 LLM api_key".into(),
        ));
    }

    let chunks = caption_chunks(caption_text);

    if stub_enabled() {
        let caption = chunks.first().cloned().unwrap_or_default();
        let cards = stub_cards(video_id, &caption);
        on_progress(&cards, 1, 1).await?;
        return Ok(ExtractOutcome {
            draft_cards: cards,
            truncated: false,
        });
    }

    let mut merged: Vec<DraftCard> = initial_cards.to_vec();
    let mut seen: HashSet<String> = initial_cards
        .iter()
        .filter_map(|c| {
            let key = normalize_front(&c.front);
            (!key.is_empty()).then_some(key)
        })
        .collect();
    let total_chunks = chunks.len();
    let mut chunk_errors: Vec<String> = Vec::new();

    for (index, chunk) in chunks.into_iter().enumerate() {
        if index < start_chunk {
            continue;
        }
        match extract_one_chunk(
            settings,
            video_id,
            title,
            &chunk,
            index + 1,
            total_chunks,
            proxy,
        )
        .await
        {
            Ok(batch) => {
                for card in batch {
                    let key = normalize_front(&card.front);
                    if key.is_empty() || !seen.insert(key) {
                        continue;
                    }
                    merged.push(card);
                }
            }
            Err(err) => {
                let msg = format!(
                    "chunk {}/{}: {}",
                    index + 1,
                    total_chunks,
                    app_error_message(&err)
                );
                tracing::warn!(error = %msg, "collect LLM chunk failed; continuing");
                chunk_errors.push(msg);
            }
        }
        on_progress(&merged, index + 1, total_chunks).await?;
        // Gentle pacing for provider / proxy stability across many segments.
        if index + 1 < total_chunks {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
    }

    if merged.is_empty() {
        let detail = if chunk_errors.is_empty() {
            "LLM produced no usable vocabulary cards".into()
        } else {
            format!(
                "LLM produced no usable vocabulary cards ({})",
                chunk_errors.join("; ").chars().take(500).collect::<String>()
            )
        };
        return Err(AppError::BadRequest(detail));
    }

    if !chunk_errors.is_empty() {
        tracing::warn!(
            ok_cards = merged.len(),
            failed_chunks = chunk_errors.len(),
            "collect finished with partial chunk failures"
        );
    }

    Ok(ExtractOutcome {
        draft_cards: merged,
        truncated: !chunk_errors.is_empty(),
    })
}

async fn extract_one_chunk(
    settings: &LlmSettingsStored,
    video_id: &str,
    title: &str,
    caption: &str,
    chunk_index: usize,
    chunk_total: usize,
    proxy: Option<&str>,
) -> Result<Vec<DraftCard>, AppError> {
    let system = r#"You extract English vocabulary cards for Chinese learners from a YouTube transcript segment.
Return ONLY a valid JSON object:
{"cards":[{"front":"...","back":"...","pronunciation":"/ˈæp.əl/","tags":["..."],"examples":[{"sentence_en":"...","translation_zh":"..."}]}]}

Hard requirements:
- Extract EVERY word or short phrase worth learning in THIS segment. Do not artificially limit quantity; cover the segment thoroughly.
- Never invent words absent from the transcript.
- front: English word or short phrase (prefer mid/advanced content words, multi-word phrases, collocations).
- back: concise Chinese meaning.
- pronunciation: REQUIRED for every card. Use IPA in slashes, e.g. /ˈæp.əl/. Never leave null/empty.
- examples: at most 1 short example per card (one sentence_en + translation_zh), preferably adapted from the transcript.
- skip ultra-common function words (the, a, is, to, of, and, that, this, it, you, I).
- Keep JSON compact. no markdown fences."#;

    let user = format!(
        "Video id: {video_id}\nTitle: {title}\nSegment: {chunk_index}/{chunk_total}\nTranscript segment:\n{caption}"
    );

    let content = chat_completion(settings, system, &user, proxy).await?;
    parse_llm_cards(&content, video_id)
}

async fn chat_completion(
    settings: &LlmSettingsStored,
    system: &str,
    user: &str,
    proxy: Option<&str>,
) -> Result<String, AppError> {
    let base = settings.base_url.trim_end_matches('/');
    let url = format!("{base}/chat/completions");

    let body = json!({
        "model": settings.model,
        "temperature": settings.temperature,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });

    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300));
    if let Some(proxy) = crate::services::youtube_captions::normalize_proxy(proxy) {
        let proxy = reqwest::Proxy::all(&proxy)
            .map_err(|e| AppError::BadRequest(format!("Invalid proxy URL: {e}")))?;
        builder = builder.proxy(proxy);
    }

    let client = builder
        .build()
        .map_err(|e| AppError::Internal(format!("http client: {e}")))?;

    let res = client
        .post(&url)
        .bearer_auth(settings.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("LLM request failed: {e}")))?;

    let status = res.status();
    let raw_bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("LLM read body failed: {e}")))?;
    let raw = String::from_utf8_lossy(&raw_bytes).into_owned();

    if !status.is_success() {
        return Err(AppError::BadRequest(format!(
            "LLM error ({status}): {}",
            raw.chars().take(300).collect::<String>()
        )));
    }

    let parsed: ChatCompletionResponse = serde_json::from_str(&raw).map_err(|e| {
        AppError::BadRequest(format!(
            "LLM response parse failed: {e}; body={}",
            raw.chars().take(240).collect::<String>()
        ))
    })?;

    let content = parsed
        .choices
        .first()
        .and_then(|c| c.message.text())
        .unwrap_or_default();
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::BadRequest(format!(
            "LLM returned empty content; body={}",
            raw.chars().take(240).collect::<String>()
        )));
    }
    Ok(content.to_string())
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

fn caption_chunks(caption_text: &str) -> Vec<String> {
    let chars: Vec<char> = caption_text.chars().collect();
    if chars.is_empty() {
        return vec![String::new()];
    }
    if chars.len() <= CHUNK_CHARS {
        return vec![chars.into_iter().collect()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + CHUNK_CHARS).min(chars.len());
        chunks.push(chars[start..end].iter().collect());
        if end >= chars.len() {
            break;
        }
        let next = end.saturating_sub(CHUNK_OVERLAP);
        // Ensure forward progress even if overlap >= chunk size.
        start = if next <= start { end } else { next };
    }
    chunks
}

fn normalize_front(front: &str) -> String {
    front.trim().to_ascii_lowercase()
}

pub fn parse_llm_cards(content: &str, video_id: &str) -> Result<Vec<DraftCard>, AppError> {
    let cleaned = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let cards = if let Ok(payload) = serde_json::from_str::<LlmPayload>(cleaned) {
        payload.cards
    } else if let Ok(list) = serde_json::from_str::<Vec<LlmCard>>(cleaned) {
        list
    } else {
        return Err(AppError::BadRequest(
            "LLM returned JSON that could not be parsed as cards".into(),
        ));
    };

    let mut out = Vec::new();
    for card in cards {
        let front = card.front.trim().to_string();
        let back = card.back.trim().to_string();
        if front.is_empty() || back.is_empty() {
            continue;
        }
        let mut tags = card.tags;
        if !tags.iter().any(|t| t == "youtube") {
            tags.push("youtube".into());
        }
        if !tags.iter().any(|t| t == video_id) {
            tags.push(video_id.to_string());
        }
        let examples = card
            .examples
            .into_iter()
            .filter_map(|ex| {
                let sentence_en = ex.sentence_en.trim().to_string();
                let translation_zh = ex.translation_zh.trim().to_string();
                if sentence_en.is_empty() || translation_zh.is_empty() {
                    None
                } else {
                    Some(CardExampleInput {
                        id: None,
                        sentence_en,
                        translation_zh,
                    })
                }
            })
            .collect();
        out.push(DraftCard {
            front,
            back,
            pronunciation: card
                .pronunciation
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty()),
            tags,
            examples,
        });
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(
            "LLM produced no usable vocabulary cards".into(),
        ));
    }
    Ok(out)
}

fn stub_enabled() -> bool {
    matches!(
        std::env::var("MOYAN_COLLECT_STUB").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

fn stub_cards(video_id: &str, _caption: &str) -> Vec<DraftCard> {
    let seeds = [
        ("persistence", "坚持；毅力", "/pəˈsɪs.təns/"),
        ("resilience", "韧性；恢复力", "/rɪˈzɪl.i.əns/"),
        ("curiosity", "好奇心", "/ˌkjʊə.riˈɒs.ə.ti/"),
        ("consistency", "一致性；连贯", "/kənˈsɪs.tən.si/"),
        ("endeavor", "努力；尝试", "/ɪnˈdev.ər/"),
        ("meticulous", "一丝不苟的", "/məˈtɪk.jə.ləs/"),
        ("eloquent", "有说服力的；雄辩的", "/ˈel.ə.kwənt/"),
        ("pronunciation", "发音", "/prəˌnʌn.siˈeɪ.ʃən/"),
        ("compound", "复合；化合物", "/ˈkɒm.paʊnd/"),
        ("elevate", "提升；提拔", "/ˈel.ɪ.veɪt/"),
        ("expression", "表达；表情", "/ɪkˈspreʃ.ən/"),
        ("review", "复习；审查", "/rɪˈvjuː/"),
    ];
    seeds
        .into_iter()
        .map(|(front, back, ipa)| DraftCard {
            front: front.to_string(),
            back: back.to_string(),
            pronunciation: Some(ipa.to_string()),
            tags: vec!["youtube".into(), video_id.to_string(), "stub".into()],
            examples: vec![CardExampleInput {
                id: None,
                sentence_en: format!("This lesson mentions {front}."),
                translation_zh: format!("本课提到了「{back}」。"),
            }],
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_object_payload() {
        let raw = r#"{"cards":[{"front":"hello","back":"你好","pronunciation":"/həˈləʊ/","tags":[],"examples":[{"sentence_en":"Say hello.","translation_zh":"打个招呼。"}]}]}"#;
        let cards = parse_llm_cards(raw, "vid").unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].front, "hello");
        assert_eq!(cards[0].pronunciation.as_deref(), Some("/həˈləʊ/"));
        assert!(cards[0].tags.contains(&"youtube".into()));
        assert!(cards[0].tags.contains(&"vid".into()));
    }

    #[test]
    fn splits_long_caption_into_chunks() {
        let text: String = (0..30_000).map(|_| 'a').collect();
        let chunks = caption_chunks(&text);
        assert!(chunks.len() >= 3);
        assert!(chunks.iter().all(|c| c.chars().count() <= CHUNK_CHARS));
    }

    #[test]
    fn covers_entire_caption_without_chunk_cap() {
        let text: String = (0..100_000)
            .map(|i| if i % 10 == 0 { ' ' } else { 'a' })
            .collect();
        let chunks = caption_chunks(&text);
        assert!(chunks.len() > 4);
        assert_eq!(chunks.last().unwrap().chars().last(), text.chars().last());
    }
}
