//! OpenAI-compatible chat completions client for vocabulary extraction.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::middleware::error::AppError;
use crate::models::{CardExampleInput, DraftCard, LlmSettingsStored};

const MAX_CAPTION_CHARS: usize = 24_000;
const MAX_CARDS: usize = 40;

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
    content: Option<String>,
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

    let truncated = caption_text.chars().count() > MAX_CAPTION_CHARS;
    let caption = if truncated {
        caption_text.chars().take(MAX_CAPTION_CHARS).collect::<String>()
    } else {
        caption_text.to_string()
    };

    if stub_enabled() {
        return Ok(ExtractOutcome {
            draft_cards: stub_cards(video_id, &caption),
            truncated,
        });
    }

    let system = r#"You extract English vocabulary cards for Chinese learners from a YouTube transcript.
Return ONLY valid JSON object: {"cards":[{"front":"...","back":"...","pronunciation":"/.../ or null","tags":["..."],"examples":[{"sentence_en":"...","translation_zh":"..."}]}]}
Rules:
- front: English word or short phrase worth learning
- back: concise Chinese meaning
- prefer content words; skip ultra-common function words (the, a, is, to, of, and)
- at most 40 cards; each card ideally 1 example from or close to the transcript
- no markdown fences"#;

    let user = format!(
        "Video id: {video_id}\nTitle: {title}\nTranscript:\n{caption}"
    );

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

    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(180));
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

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "LLM error ({status}): {}",
            text.chars().take(300).collect::<String>()
        )));
    }

    let parsed: ChatCompletionResponse = res
        .json()
        .await
        .map_err(|e| AppError::BadRequest(format!("LLM response parse failed: {e}")))?;

    let content = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.as_deref())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err(AppError::BadRequest("LLM returned empty content".into()));
    }

    let draft_cards = parse_llm_cards(content, video_id)?;
    Ok(ExtractOutcome {
        draft_cards,
        truncated,
    })
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
    for card in cards.into_iter().take(MAX_CARDS) {
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

fn stub_cards(video_id: &str, caption: &str) -> Vec<DraftCard> {
    let seeds = [
        ("persistence", "坚持；毅力"),
        ("resilience", "韧性；恢复力"),
        ("curiosity", "好奇心"),
        ("consistency", "一致性；连贯"),
        ("endeavor", "努力；尝试"),
        ("meticulous", "一丝不苟的"),
        ("eloquent", "有说服力的；雄辩的"),
        ("pronunciation", "发音"),
    ];
    seeds
        .into_iter()
        .filter(|(front, _)| caption.to_ascii_lowercase().contains(&front.to_ascii_lowercase()) || true)
        .take(8)
        .map(|(front, back)| DraftCard {
            front: front.to_string(),
            back: back.to_string(),
            pronunciation: None,
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
        let raw = r#"{"cards":[{"front":"hello","back":"你好","pronunciation":null,"tags":[],"examples":[{"sentence_en":"Say hello.","translation_zh":"打个招呼。"}]}]}"#;
        let cards = parse_llm_cards(raw, "vid").unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].front, "hello");
        assert!(cards[0].tags.contains(&"youtube".into()));
        assert!(cards[0].tags.contains(&"vid".into()));
    }
}
