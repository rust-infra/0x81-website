use axum::{extract::State, response::Json};
use tracing::info;

use crate::middleware::auth::Claims;
use crate::middleware::error::{success, AppError, AppState};
use crate::models::{UpdateSettingsRequest, UserSettings};

pub async fn get(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings = state.services.settings.get(&claims.sub).await?;
    info!(
        user_id = %claims.sub,
        route = "/api/settings",
        action = "get",
        has_settings = has_any_settings(&settings),
        "settings fetched"
    );
    Ok(success(settings))
}

pub async fn update(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<UpdateSettingsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let updated_fields = summarize_settings(&req.settings);
    let settings = state
        .services
        .settings
        .save(&claims.sub, &req.settings)
        .await?;
    info!(
        user_id = %claims.sub,
        route = "/api/settings",
        action = "update",
        updated_fields = %updated_fields,
        "settings saved"
    );
    Ok(success(settings))
}

fn has_any_settings(settings: &UserSettings) -> bool {
    settings.theme.is_some()
        || settings.language.is_some()
        || settings.speech_provider.is_some()
        || settings.speech_voice.is_some()
        || settings.speech_zh_voice.is_some()
        || settings.speech_model.is_some()
        || settings.speech_speed.is_some()
        || settings.auto_play.is_some()
}

fn summarize_settings(settings: &UserSettings) -> String {
    let mut fields = Vec::new();
    if settings.theme.is_some() {
        fields.push("theme");
    }
    if settings.language.is_some() {
        fields.push("language");
    }
    if settings.speech_provider.is_some() {
        fields.push("speech_provider");
    }
    if settings.speech_voice.is_some() {
        fields.push("speech_voice");
    }
    if settings.speech_zh_voice.is_some() {
        fields.push("speech_zh_voice");
    }
    if settings.speech_model.is_some() {
        fields.push("speech_model");
    }
    if settings.speech_speed.is_some() {
        fields.push("speech_speed");
    }
    if settings.auto_play.is_some() {
        fields.push("auto_play");
    }

    if fields.is_empty() {
        "none".to_string()
    } else {
        fields.join(",")
    }
}
