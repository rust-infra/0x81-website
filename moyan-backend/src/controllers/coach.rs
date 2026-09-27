//! `/api/coach/*` 用户侧接口。

use axum::extract::{Query, State};
use axum::Json;
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
