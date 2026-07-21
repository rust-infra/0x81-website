use axum::{response::IntoResponse, Json};
use serde_json::json;

pub async fn ping() -> impl IntoResponse {
    Json(json!({ "success": true, "data": { "ok": true } }))
}
