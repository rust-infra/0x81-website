use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde_json::json;

use crate::middleware::error::{success, AppError, AppState};
use crate::models::{
    AdminCreateDeckRequest, AdminUpdateDeckRequest, CreateCardRequest, PageQuery,
    UpdateCardRequest,
};

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
