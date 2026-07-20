use axum::{extract::State, response::Json};

use crate::middleware::auth::Claims;
use crate::middleware::error::{AppError, AppState, success};
use crate::models::{UploadRequest, UploadResponse};

/// Upload sync data - saves user's learning data to server.
pub async fn upload(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<UploadRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let receipt = state.services.sync.upload(&claims.sub, &req.data).await?;
    let response = UploadResponse {
        sync_id: receipt.sync_id,
        cards_synced: receipt.cards_synced,
        decks_synced: receipt.decks_synced,
        logs_synced: receipt.logs_synced,
        timestamp: receipt.timestamp,
    };
    Ok(success(response))
}

/// Download sync data - retrieve user's learning data from server.
pub async fn download(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.sync.download(&claims.sub).await?))
}

/// Get sync status.
pub async fn status(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.sync.status(&claims.sub).await?))
}
