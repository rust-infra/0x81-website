//! `/interview/text` 的图片分支：图片 → 纯文本。
//!
//! 只做逐字识别：不总结、不改写、不补充。结构化是下一步，中间隔着用户编辑。
//! 图片只在内存中处理，不落盘、不写日志。

use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::services::admin_collect::AdminCollectService;
use crate::services::coach_quota::CoachQuotaService;
use crate::services::llm_client::{self, ImagePart};

pub const MAX_IMAGES: usize = 5;
pub const MAX_IMAGE_BYTES: usize = 1024 * 1024;
pub const MAX_TOTAL_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_OCR_TOKENS: u32 = 4_000;

const OCR_SYSTEM_PROMPT: &str = "You transcribe documents verbatim. Return JSON only: \
{\"text\":\"...\"}\n\
Transcribe every visible character exactly as it appears, including headings, dates, numbers and \
contact details. Do NOT summarise, translate, rewrite, reorder or fill in gaps. Preserve line \
breaks between logical blocks. If a region is unreadable, write [unclear] in place.";

#[derive(Clone)]
pub struct InterviewOcrService {
    quota: CoachQuotaService,
    admin_collect: Arc<AdminCollectService>,
}

impl InterviewOcrService {
    pub fn new(quota: CoachQuotaService, admin_collect: Arc<AdminCollectService>) -> Self {
        Self {
            quota,
            admin_collect,
        }
    }

    pub async fn ocr(&self, user_id: &str, images: Vec<ImagePart>) -> Result<String, AppError> {
        validate_images(&images)?;
        self.quota.check_and_consume(user_id).await?;

        let settings = self.admin_collect.llm_settings().await?;
        let result = llm_client::chat_json_with_images(
            &settings,
            OCR_SYSTEM_PROMPT,
            "Transcribe the attached document images.",
            &images,
            Some(MAX_OCR_TOKENS),
        )
        .await;

        match result {
            Ok(raw) => parse_ocr_payload(&raw),
            Err(AppError::BadRequest(message)) if vision_unsupported_hint(&message) => {
                Err(AppError::Unprocessable {
                    reason: "vision_not_supported",
                    message: "The configured model does not accept image input. \
                              Use pasted text, or ask the admin to switch to a vision-capable model \
                              such as deepseek-flash."
                        .into(),
                })
            }
            Err(e) => Err(e),
        }
    }
}

pub fn validate_images(images: &[ImagePart]) -> Result<(), AppError> {
    use base64::Engine as _;

    if images.is_empty() {
        return Err(AppError::BadRequest(
            "at least one image is required".into(),
        ));
    }
    if images.len() > MAX_IMAGES {
        return Err(AppError::BadRequest(format!("at most {MAX_IMAGES} images")));
    }

    let mut total_bytes = 0usize;
    for image in images {
        if !image.media_type.starts_with("image/") {
            return Err(AppError::BadRequest("media_type must be image/*".into()));
        }
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&image.data_base64)
            .map_err(|_| AppError::BadRequest("image data is not valid base64".into()))?;
        if decoded.len() > MAX_IMAGE_BYTES {
            return Err(AppError::BadRequest(
                "each image must be at most 1MB".into(),
            ));
        }
        total_bytes = total_bytes.saturating_add(decoded.len());
    }
    if total_bytes > MAX_TOTAL_IMAGE_BYTES {
        return Err(AppError::BadRequest("images must total at most 4MB".into()));
    }
    Ok(())
}

pub fn vision_unsupported_hint(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    let mentions_image = m.contains("image") || m.contains("vision") || m.contains("multimodal");
    let mentions_rejection = m.contains("not support")
        || m.contains("unsupported")
        || m.contains("invalid")
        || m.contains("does not");
    mentions_image && mentions_rejection
}

#[derive(serde::Deserialize)]
struct LlmOcrPayload {
    text: String,
}

pub fn parse_ocr_payload(raw: &str) -> Result<String, AppError> {
    let cleaned = crate::services::strip_code_fences(raw);
    let payload: LlmOcrPayload = serde_json::from_str(&cleaned)
        .map_err(|e| AppError::BadRequest(format!("invalid OCR JSON: {e}")))?;
    let text = payload.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadRequest("OCR returned no text".into()));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_parts_put_text_first_then_images_with_high_detail() {
        let images = vec![
            llm_client::ImagePart {
                media_type: "image/jpeg".into(),
                data_base64: "AAA".into(),
            },
            llm_client::ImagePart {
                media_type: "image/jpeg".into(),
                data_base64: "BBB".into(),
            },
        ];
        let parts = llm_client::build_content_parts("transcribe this", &images);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[0]["text"], "transcribe this");
        assert_eq!(parts[1]["image_url"]["url"], "data:image/jpeg;base64,AAA");
        assert_eq!(parts[1]["image_url"]["detail"], "high");
        assert_eq!(parts[2]["image_url"]["url"], "data:image/jpeg;base64,BBB");
    }

    #[test]
    fn vision_unsupported_hint_matches_upstream_wording() {
        assert!(vision_unsupported_hint(
            "LLM error (400 Bad Request): model does not support image input"
        ));
        assert!(vision_unsupported_hint(
            "invalid content type: vision not supported"
        ));
        assert!(!vision_unsupported_hint("LLM error (429): rate limited"));
        assert!(!vision_unsupported_hint("invalid api key"));
    }

    #[test]
    fn parses_ocr_payload() {
        let raw = r#"{"text":"Alice Chen\nBackend Engineer"}"#;
        assert_eq!(
            parse_ocr_payload(raw).unwrap(),
            "Alice Chen\nBackend Engineer"
        );
    }

    #[test]
    fn rejects_empty_ocr_result() {
        assert!(parse_ocr_payload(r#"{"text":"   "}"#).is_err());
    }

    #[test]
    fn validates_image_count_type_and_size() {
        use base64::Engine as _;

        let build = |count: usize, media_type: &str, size: usize| {
            let encoded = base64::engine::general_purpose::STANDARD.encode(vec![b'A'; size]);
            (0..count)
                .map(|_| llm_client::ImagePart {
                    media_type: media_type.into(),
                    data_base64: encoded.clone(),
                })
                .collect::<Vec<_>>()
        };
        assert!(validate_images(&build(1, "image/jpeg", 8)).is_ok());
        assert!(validate_images(&build(6, "image/jpeg", 8)).is_err());
        assert!(validate_images(&build(1, "application/pdf", 8)).is_err());
        assert!(validate_images(&build(1, "image/jpeg", MAX_IMAGE_BYTES + 1)).is_err());
        assert!(validate_images(&[]).is_err());
    }
}
