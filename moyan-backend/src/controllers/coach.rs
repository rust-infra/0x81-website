//! `/api/coach/*` 用户侧接口。

use axum::extract::Query;
use axum::Json;
use serde::Deserialize;

use crate::middleware::error::AppError;
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
