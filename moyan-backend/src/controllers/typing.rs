use axum::{
    extract::{Query, State},
    response::Json,
};
use serde::Deserialize;

use crate::middleware::auth::Claims;
use crate::middleware::error::{success, AppError, AppState};
use crate::models::{TypeMistakeSyncRequest, TypeResume, TypeSyncRequest};

#[derive(Debug, Deserialize)]
pub struct ResumeQuery {
    pub deck_id: Option<String>,
}

pub async fn sync(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<TypeSyncRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state.services.typing.sync(&claims.sub, req).await?;
    Ok(success(result))
}

pub async fn stats(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.typing.stats(&claims.sub).await?))
}

/// 错题本：打错的词（含每词累计准确率与错字次数）。
pub async fn list_mistakes(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.typing.mistakes(&claims.sub).await?))
}

/// 错题本增量同步：add = 本批打错的词，remove = 本批打到 100% 准确率的词。
pub async fn sync_mistakes(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<TypeMistakeSyncRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(
        state.services.typing.mistakes_sync(&claims.sub, req).await?,
    ))
}

pub async fn put_resume(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<TypeResume>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.services.typing.put_resume(&claims.sub, req).await?;
    Ok(success(serde_json::json!({ "saved": true })))
}

pub async fn get_resume(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Query(query): Query<ResumeQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck_id = query.deck_id.unwrap_or_default();
    Ok(success(
        state.services.typing.get_resume(&claims.sub, &deck_id).await?,
    ))
}

pub async fn delete_resume(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Query(query): Query<ResumeQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck_id = query.deck_id.unwrap_or_default();
    state
        .services
        .typing
        .delete_resume(&claims.sub, &deck_id)
        .await?;
    Ok(success(serde_json::json!({ "deleted": true })))
}
