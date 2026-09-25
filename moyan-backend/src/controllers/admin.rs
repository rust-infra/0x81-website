use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;

use crate::models::PodcastConfig;
use serde_json::json;

use crate::middleware::error::{success, AppError, AppState};
use crate::models::{
    AdminCreateDeckRequest, AdminUpdateDeckRequest, CreateCardRequest, ImportMode, PageQuery,
    PatchAdminUserRequest, UpdateCardRequest,
};

#[derive(Debug, Deserialize)]
pub struct ImportQuery {
    pub mode: Option<String>,
}

pub async fn ping() -> impl IntoResponse {
    Json(json!({ "success": true, "data": { "ok": true } }))
}

pub async fn list_decks(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = state.services.admin.list_decks(query).await?;
    Ok(success(page))
}

pub async fn create_deck(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<AdminCreateDeckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck = state.services.admin.create_deck(req).await?;
    Ok(success(deck))
}

pub async fn update_deck(
    State(state): State<AppState>,
    Path(deck_id): Path<String>,
    axum::Json(req): axum::Json<AdminUpdateDeckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck = state.services.admin.update_deck(&deck_id, req).await?;
    Ok(success(deck))
}

pub async fn delete_deck(
    State(state): State<AppState>,
    Path(deck_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.services.admin.delete_deck(&deck_id).await?;
    Ok(success(json!(null)))
}

pub async fn list_cards(
    State(state): State<AppState>,
    Path(deck_id): Path<String>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = state.services.admin.list_cards(&deck_id, query).await?;
    Ok(success(page))
}

pub async fn create_card(
    State(state): State<AppState>,
    Path(deck_id): Path<String>,
    axum::Json(req): axum::Json<CreateCardRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let card = state.services.admin.create_card(&deck_id, req).await?;
    Ok(success(card))
}

pub async fn update_card(
    State(state): State<AppState>,
    Path(card_id): Path<String>,
    axum::Json(req): axum::Json<UpdateCardRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let card = state.services.admin.update_card(&card_id, req).await?;
    Ok(success(card))
}

pub async fn delete_card(
    State(state): State<AppState>,
    Path(card_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.services.admin.delete_card(&card_id).await?;
    Ok(success(json!(null)))
}

pub async fn list_users(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = state.services.admin.list_users(query).await?;
    Ok(success(page))
}

pub async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let detail = state.services.admin.get_user(&user_id).await?;
    Ok(success(detail))
}

pub async fn patch_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    axum::Json(req): axum::Json<PatchAdminUserRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = state.services.admin.patch_user(&user_id, req).await?;
    Ok(success(user))
}

pub async fn download_vocabulary_template(
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let bytes = state.services.admin.build_vocabulary_template_xlsx()?;
    Ok(spreadsheet_attachment(
        bytes,
        "vocabulary-template.xlsx",
    ))
}

pub async fn export_vocabulary_xlsx(
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let bytes = state.services.admin.export_vocabulary_xlsx().await?;
    Ok(spreadsheet_attachment(bytes, "vocabulary-export.xlsx"))
}

pub async fn export_vocabulary_json(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let export = state.services.admin.export_vocabulary_json().await?;
    Ok(success(export))
}

pub async fn import_vocabulary(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let mode = ImportMode::parse(query.mode.as_deref())
        .map_err(|message| AppError::BadRequest(message))?;

    let mut file_bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("Invalid multipart upload: {err}")))?
    {
        if field.name() == Some("file") {
            let bytes = field
                .bytes()
                .await
                .map_err(|err| AppError::BadRequest(format!("Failed to read upload: {err}")))?;
            file_bytes = Some(bytes.to_vec());
        }
    }

    let data = file_bytes.ok_or_else(|| AppError::BadRequest("Missing upload field 'file'".into()))?;
    let result = state.services.admin.import_vocabulary(&data, mode).await?;
    Ok(success(result))
}

pub async fn get_llm_settings(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings = state.services.admin_collect.get_llm_settings().await?;
    Ok(success(settings))
}

pub async fn update_llm_settings(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::UpdateLlmSettingsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings = state.services.admin_collect.update_llm_settings(req).await?;
    Ok(success(settings))
}

#[derive(Debug, Deserialize)]
pub struct PodcastConfigUpdate {
    pub app_enabled: Option<bool>,
    pub web_enabled: Option<bool>,
    pub youtube_api_key: Option<String>,
}

pub async fn get_podcast_config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = state.services.podcast.config().await?;
    Ok(success(cfg.podcast))
}

pub async fn update_podcast_config(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<PodcastConfigUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 先读当前配置，未提供的字段保持原值
    let current = state.services.podcast.config().await?;
    let app_enabled = req.app_enabled.unwrap_or(current.podcast.app_enabled);
    let web_enabled = req.web_enabled.unwrap_or(current.podcast.web_enabled);
    let youtube_api_key = req
        .youtube_api_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&current.podcast.youtube_api_key);
    let cfg = state
        .services
        .podcast
        .set_config(app_enabled, web_enabled, youtube_api_key)
        .await?;
    let cfg: PodcastConfig = cfg.podcast;
    Ok(success(cfg))
}

pub async fn collect_youtube_captions(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::YoutubeCaptionsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.fetch_captions(req).await?;
    Ok(success(data))
}

pub async fn collect_youtube_extract(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::YoutubeExtractRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.extract_cards(req).await?;
    Ok(success(data))
}

pub async fn collect_youtube_import(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::YoutubeImportRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.import_cards(req).await?;
    Ok(success(data))
}

pub async fn create_collect_job(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<crate::models::CreateCollectJobRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.create_job(req).await?;
    Ok(success(data))
}

pub async fn list_collect_jobs(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<crate::models::CollectJobListQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.list_jobs(query).await?;
    Ok(success(data))
}

pub async fn get_collect_job(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.get_job(&id).await?;
    Ok(success(data))
}

pub async fn delete_collect_job(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.services.admin_collect.delete_job(&id).await?;
    Ok(success(serde_json::json!({ "deleted": true })))
}

pub async fn pause_collect_job(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.pause_job(&id).await?;
    Ok(success(data))
}

pub async fn copy_collect_job(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let data = state.services.admin_collect.copy_job(&id).await?;
    Ok(success(data))
}

fn spreadsheet_attachment(bytes: Vec<u8>, filename: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(bytes))
        .expect("valid spreadsheet response")
}
