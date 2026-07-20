use axum::{
    extract::{Path, State},
    response::Json,
};
use serde_json::json;

use crate::middleware::auth::Claims;
use crate::middleware::error::{success, AppError, AppState};
use crate::models::{
    CreateCardRequest, CreateDeckRequest, CreateReviewLogRequest, UpdateCardRequest,
    UpdateDeckRequest, UpsertCardProgressRequest,
};

pub async fn list_decks(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let decks = state.services.vocabulary.list_decks(&claims.sub).await?;
    Ok(success(decks))
}

pub async fn create_deck(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<CreateDeckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck = state
        .services
        .vocabulary
        .create_deck(&claims.sub, req)
        .await?;
    Ok(success(deck))
}

pub async fn update_deck(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(deck_id): Path<String>,
    axum::Json(req): axum::Json<UpdateDeckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deck = state
        .services
        .vocabulary
        .update_deck(&claims.sub, &deck_id, req)
        .await?;
    Ok(success(deck))
}

pub async fn delete_deck(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(deck_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .services
        .vocabulary
        .delete_deck(&claims.sub, &deck_id)
        .await?;
    Ok(success(json!(null)))
}

pub async fn list_cards(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(deck_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cards = state
        .services
        .vocabulary
        .list_cards(&claims.sub, &deck_id)
        .await?;
    Ok(success(cards))
}

pub async fn create_card(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(deck_id): Path<String>,
    axum::Json(req): axum::Json<CreateCardRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let card = state
        .services
        .vocabulary
        .create_card(&claims.sub, &deck_id, req)
        .await?;
    Ok(success(card))
}

pub async fn list_study_cards(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(deck_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cards = state
        .services
        .vocabulary
        .list_study_cards(&claims.sub, &deck_id)
        .await?;
    Ok(success(cards))
}

pub async fn update_card(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(card_id): Path<String>,
    axum::Json(req): axum::Json<UpdateCardRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let card = state
        .services
        .vocabulary
        .update_card(&claims.sub, &card_id, req)
        .await?;
    Ok(success(card))
}

pub async fn delete_card(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(card_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .services
        .vocabulary
        .delete_card(&claims.sub, &card_id)
        .await?;
    Ok(success(json!(null)))
}

pub async fn upsert_progress(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(card_id): Path<String>,
    axum::Json(req): axum::Json<UpsertCardProgressRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let progress = state
        .services
        .vocabulary
        .upsert_progress(&claims.sub, &card_id, req)
        .await?;
    Ok(success(progress))
}

pub async fn create_review_log(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<CreateReviewLogRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let log = state
        .services
        .vocabulary
        .create_review_log(&claims.sub, req)
        .await?;
    Ok(success(log))
}
