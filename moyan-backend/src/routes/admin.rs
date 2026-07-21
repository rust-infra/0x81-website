use axum::{
    middleware,
    routing::{get, put},
    Router,
};

use crate::controllers::admin;
use crate::middleware::admin_auth::admin_token_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ping", get(admin::ping))
        .route("/decks", get(admin::list_decks).post(admin::create_deck))
        .route(
            "/decks/{deck_id}",
            put(admin::update_deck).delete(admin::delete_deck),
        )
        .route(
            "/decks/{deck_id}/cards",
            get(admin::list_cards).post(admin::create_card),
        )
        .route(
            "/cards/{card_id}",
            put(admin::update_card).delete(admin::delete_card),
        )
        .layer(middleware::from_fn(admin_token_middleware))
}
