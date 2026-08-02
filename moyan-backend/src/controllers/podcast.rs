use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::middleware::error::{success, AppError, AppState};

pub async fn config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.podcast.config().await?))
}

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub url: String,
}

pub async fn resolve(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<ResolveRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.podcast.resolve(&req.url).await?))
}

pub async fn audio(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
) -> Result<Response, AppError> {
    let path = state.services.podcast.audio_path(&video_id).await?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| AppError::Internal(format!("read audio: {e}")))?;
    Ok(([(header::CONTENT_TYPE, "audio/mpeg")], bytes).into_response())
}

pub async fn translate(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings = state.services.admin_collect.llm_settings().await?;
    Ok(success(
        state
            .services
            .podcast
            .translate(&video_id, &settings)
            .await?,
    ))
}
