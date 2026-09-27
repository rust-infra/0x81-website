//! `/api/coach/*` 用户侧接口。

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

use crate::middleware::error::{AppError, AppState};
use crate::services::coach_scenarios;

#[derive(Debug, Deserialize)]
pub struct ScenarioQuery {
    pub locale: Option<String>,
}

pub async fn list_scenarios(
    Query(query): Query<ScenarioQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let locale = query.locale.unwrap_or_else(|| "zh-CN".to_string());
    let items = coach_scenarios::list_presets(&locale);
    Ok(Json(serde_json::json!({ "success": true, "data": items })))
}

pub async fn quota(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (limit, used, resets_at) = state.services.coach_quota.snapshot(&claims.sub).await?;
    let remaining = if limit == 0 {
        None
    } else {
        Some(limit.saturating_sub(used))
    };
    Ok(Json(serde_json::json!({
        "success": true,
        "data": {
            "limit": limit,
            "used": used,
            "remaining": remaining,
            "resets_at": resets_at,
        }
    })))
}

pub async fn turn(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Json(req): axum::Json<crate::models::CoachTurnRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state.services.coach.turn(&claims.sub, req).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": result })))
}

pub async fn summary(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::CoachSummaryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state.services.coach.summary(req).await?;
    Ok(Json(serde_json::json!({ "success": true, "data": result })))
}

pub async fn scenario_draft(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Json(req): axum::Json<crate::models::CoachScenarioDraftRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let scenario = state
        .services
        .coach
        .draft_scenario(&claims.sub, req)
        .await?;
    Ok(Json(
        serde_json::json!({ "success": true, "data": scenario }),
    ))
}

pub async fn interview_text(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut docs: Vec<(String, Vec<u8>)> = Vec::new();
    let mut images: Vec<crate::services::llm_client::ImagePart> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid multipart: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        let file_name = field.file_name().unwrap_or_default().to_string();
        let content_type = field.content_type().unwrap_or_default().to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("read upload: {e}")))?
            .to_vec();

        match name.as_str() {
            "docs" => docs.push((file_name, bytes)),
            "images" => {
                use base64::Engine as _;
                let media_type = if content_type.is_empty() {
                    "image/jpeg".to_string()
                } else {
                    content_type
                };
                images.push(crate::services::llm_client::ImagePart {
                    media_type,
                    data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                });
            }
            _ => {}
        }
    }

    if !images.is_empty() {
        let text = state
            .services
            .interview_ocr
            .ocr(&claims.sub, images)
            .await?;
        return Ok(Json(serde_json::json!({
            "success": true,
            "data": {
                "text": text,
                "char_count": text.chars().count(),
                "likely_scanned": false,
                "source": "image",
            }
        })));
    }

    let (file_name, bytes) = docs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::BadRequest("docs or images is required".into()))?;
    let parsed = crate::services::interview_docs::parse_document(&file_name, &bytes)?;
    Ok(Json(serde_json::json!({
        "success": true,
        "data": {
            "text": parsed.text,
            "char_count": parsed.char_count,
            "likely_scanned": parsed.likely_scanned,
            "source": "document",
        }
    })))
}

pub async fn interview_profile(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Json(req): axum::Json<crate::models::InterviewProfileRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile = state.services.interview_profile.profile(&claims.sub, req).await?;
    Ok(Json(
        serde_json::json!({ "success": true, "data": profile }),
    ))
}
