//! 用户确认过的材料文本 → 紧凑面试档案。
//!
//! 只接受文本：图片与原文在 Task 13 之后就不再参与。档案是后续 `/turn` 与
//! `/summary` 唯一携带的材料内容。

use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{InterviewProfileRequest, InterviewProfileResponse};
use crate::services::admin_collect::AdminCollectService;
use crate::services::coach_quota::CoachQuotaService;
use crate::services::llm_client;

pub const MAX_TEXT_CHARS: usize = 20_000;
const MAX_PROFILE_TOKENS: u32 = 1_600;

const RESUME_PROMPT: &str = "You extract hiring-focused profiles from resumes. Return JSON only: \
{\"profile\":\"...\"}\n\
Cover: years and domain, core tech stack, 2-3 notable projects with concrete outcomes, and 3 likely \
interview follow-up angles. Under 800 characters, Simplified Chinese. \
Never invent facts that are not in the text.";

const JOB_PROMPT: &str = "You extract hiring-focused profiles from job postings. Return JSON only: \
{\"profile\":\"...\"}\n\
Cover: role and seniority, must-have skills, nice-to-have skills, and the 3 capabilities the interview \
will most likely probe. Under 600 characters, Simplified Chinese. \
Never invent requirements that are not in the text.";

#[derive(Clone)]
pub struct InterviewProfileService {
    quota: CoachQuotaService,
    admin_collect: Arc<AdminCollectService>,
}

impl InterviewProfileService {
    pub fn new(quota: CoachQuotaService, admin_collect: Arc<AdminCollectService>) -> Self {
        Self {
            quota,
            admin_collect,
        }
    }

    pub async fn profile(
        &self,
        user_id: &str,
        req: InterviewProfileRequest,
    ) -> Result<InterviewProfileResponse, AppError> {
        validate_request(&req)?;
        self.quota.check_and_consume(user_id).await?;

        let system = if req.kind == "job" {
            JOB_PROMPT
        } else {
            RESUME_PROMPT
        };
        let settings = self.admin_collect.llm_settings().await?;
        let raw = llm_client::chat_json(
            &settings,
            system,
            req.text.trim(),
            None,
            Some(MAX_PROFILE_TOKENS),
        )
        .await
        .map_err(|_| {
            AppError::ServiceUnavailable(
                "AI profile extraction is temporarily unavailable".into(),
            )
        })?;

        Ok(InterviewProfileResponse {
            kind: req.kind.clone(),
            profile: parse_profile_payload(&raw, &req.kind)?,
        })
    }
}

pub fn validate_request(req: &InterviewProfileRequest) -> Result<(), AppError> {
    if req.kind != "resume" && req.kind != "job" {
        return Err(AppError::BadRequest(
            "kind must be resume or job".into(),
        ));
    }
    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("text is required".into()));
    }
    if req.text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::BadRequest(format!(
            "text must be at most {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct LlmProfilePayload {
    profile: String,
}

pub fn parse_profile_payload(raw: &str, _kind: &str) -> Result<String, AppError> {
    let cleaned = crate::services::strip_code_fences(raw);
    let payload: LlmProfilePayload = serde_json::from_str(&cleaned)
        .map_err(|e| AppError::BadRequest(format!("invalid profile JSON: {e}")))?;
    let profile = payload.profile.trim().to_string();
    if profile.is_empty() {
        return Err(AppError::BadRequest("profile was empty".into()));
    }
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(kind: &str, text: &str) -> InterviewProfileRequest {
        InterviewProfileRequest {
            kind: kind.into(),
            text: text.into(),
        }
    }

    #[test]
    fn parses_profile_payload() {
        let raw = r#"{"profile":"5 年后端，主导过支付网关"}"#;
        assert_eq!(
            parse_profile_payload(raw, "resume").unwrap(),
            "5 年后端，主导过支付网关"
        );
    }

    #[test]
    fn strips_markdown_fences() {
        let raw = "```json\n{\"profile\":\"ok\"}\n```";
        assert_eq!(parse_profile_payload(raw, "job").unwrap(), "ok");
    }

    #[test]
    fn rejects_empty_profile() {
        assert!(parse_profile_payload(r#"{"profile":"  "}"#, "resume").is_err());
    }

    #[test]
    fn validates_kind_and_length() {
        assert!(validate_request(&req("resume", "x")).is_ok());
        assert!(validate_request(&req("job", "x")).is_ok());
        assert!(validate_request(&req("cv", "x")).is_err());
        assert!(validate_request(&req("resume", "   ")).is_err());
        assert!(validate_request(&req("resume", &"字".repeat(MAX_TEXT_CHARS + 1))).is_err());
    }
}
