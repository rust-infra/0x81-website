use axum::{
    body::Body,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;
use tracing::error;

use crate::models::ImportErrorItem;
use crate::repositories::RepositoryError;
use crate::services::Services;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub services: Services,
    pub jwt_secret: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub google_redirect_url: String,
    pub google_mobile_client_id: String,
    pub google_mobile_client_secret: String,
    pub google_mobile_redirect_url: String,
    pub admin_token: String,
    pub telegram_bot_token: String,
    /// 是否允许非 JWT 的 legacy token 兜底认证（仅开发；线上必须为 false）。
    /// 详见 `middleware::auth::legacy_token_auth_allowed`。
    pub allow_legacy_token_auth: bool,
}

/// Application-wide error type
#[derive(Debug)]
pub enum AppError {
    Unauthorized(String),
    BadRequest(String),
    NotFound(String),
    Internal(String),
    ServiceUnavailable(String),
    /// 每日用量用尽：返回 429，并带上 limit / used / resets_at 供 App 展示。
    QuotaExceeded {
        limit: u32,
        used: u32,
        resets_at: String,
    },
    /// Request was valid JSON but cannot be processed with current upstream capability.
    Unprocessable {
        reason: &'static str,
        message: String,
    },
    ImportFailed(Vec<ImportErrorItem>),
    Repository(RepositoryError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response<Body> {
        let (status, message) = match &self {
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg.clone()),
            AppError::QuotaExceeded {
                limit,
                used,
                resets_at,
            } => {
                let body = Json(json!({
                    "success": false,
                    "error": {
                        "code": 429,
                        "reason": "coach_quota_exceeded",
                        "message": "Daily coach quota exceeded",
                        "limit": limit,
                        "used": used,
                        "resets_at": resets_at,
                    }
                }));
                return (StatusCode::TOO_MANY_REQUESTS, body).into_response();
            }
            AppError::Unprocessable { reason, message } => {
                let body = Json(json!({
                    "success": false,
                    "error": { "code": 422, "reason": reason, "message": message }
                }));
                return (StatusCode::UNPROCESSABLE_ENTITY, body).into_response();
            }
            AppError::ImportFailed(errors) => {
                let body = Json(json!({
                    "success": false,
                    "errors": errors
                }));
                return (StatusCode::BAD_REQUEST, body).into_response();
            }
            AppError::Internal(msg) => {
                error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
            AppError::Repository(err) => {
                error!("Repository error: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Database error".to_string(),
                )
            }
        };

        let body = Json(json!({
            "success": false,
            "error": {
                "code": status.as_u16(),
                "message": message
            }
        }));

        (status, body).into_response()
    }
}

impl From<RepositoryError> for AppError {
    fn from(err: RepositoryError) -> Self {
        AppError::Repository(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::BadRequest(format!("JSON parse error: {}", err))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Internal(format!("HTTP request error: {}", err))
    }
}

/// Success response wrapper
pub fn success<T: serde::Serialize>(data: T) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "data": data
    }))
}
