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
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut docs: Vec<(String, Vec<u8>)> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid multipart: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        let file_name = field.file_name().unwrap_or_default().to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("read upload: {e}")))?
            .to_vec();
        if name == "docs" {
            docs.push((file_name, bytes));
        }
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
