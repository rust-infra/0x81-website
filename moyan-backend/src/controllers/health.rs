use axum::{extract::State, response::Json};
use chrono::Utc;
use serde_json::json;

use crate::middleware::error::{AppError, AppState, success};

/// Health check endpoint
pub async fn health_check(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let db_healthy = state.services.health.database_is_healthy().await;

    let health = json!({
        "status": if db_healthy { "healthy" } else { "unhealthy" },
        "database": db_healthy,
        "database_backend": state.services.health.database_backend(),
        "timestamp": Utc::now().to_rfc3339(),
        "version": env!("CARGO_PKG_VERSION"),
    });

    Ok(success(health))
}
