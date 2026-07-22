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
        .route(
            "/vocabulary/template.xlsx",
            get(admin::download_vocabulary_template),
        )
        .route("/vocabulary/export.xlsx", get(admin::export_vocabulary_xlsx))
        .route("/vocabulary/export.json", get(admin::export_vocabulary_json))
        .route("/vocabulary/import", axum::routing::post(admin::import_vocabulary))
        .route("/users", get(admin::list_users))
        .route(
            "/users/{user_id}",
            get(admin::get_user).patch(admin::patch_user),
        )
        .route(
            "/settings/llm",
            get(admin::get_llm_settings).put(admin::update_llm_settings),
        )
        .route(
            "/collect/youtube/captions",
            axum::routing::post(admin::collect_youtube_captions),
        )
        .route(
            "/collect/youtube/extract",
            axum::routing::post(admin::collect_youtube_extract),
        )
        .route(
            "/collect/youtube/import",
            axum::routing::post(admin::collect_youtube_import),
        )
        .layer(middleware::from_fn(admin_token_middleware))
}
