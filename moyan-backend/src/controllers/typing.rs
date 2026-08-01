use axum::{extract::State, response::Json};

use crate::middleware::auth::Claims;
use crate::middleware::error::{success, AppError, AppState};
use crate::models::TypeSyncRequest;

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
