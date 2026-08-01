use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};

use crate::controllers::vocabulary;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/decks", get(vocabulary::list_decks).post(vocabulary::create_deck))
        .route(
            "/decks/{deck_id}",
            put(vocabulary::update_deck).delete(vocabulary::delete_deck),
        )
        .route(
            "/decks/{deck_id}/cards",
            get(vocabulary::list_cards).post(vocabulary::create_card),
        )
        .route(
            "/decks/{deck_id}/study-cards",
            get(vocabulary::list_study_cards),
        )
        .route("/study/queue", get(vocabulary::study_queue))
        .route(
            "/cards/{card_id}",
            put(vocabulary::update_card).delete(vocabulary::delete_card),
        )
        .route(
            "/card-progress/{card_id}",
            put(vocabulary::upsert_progress),
        )
        .route("/review-logs", post(vocabulary::create_review_log))
        .layer(middleware::from_fn(jwt_middleware))
}
