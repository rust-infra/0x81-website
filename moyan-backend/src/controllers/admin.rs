use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::middleware::error::{success, AppError, AppState};
use crate::models::{
    AdminCreateDeckRequest, AdminUpdateDeckRequest, CreateCardRequest, ImportMode, PageQuery,
    UpdateCardRequest,
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
