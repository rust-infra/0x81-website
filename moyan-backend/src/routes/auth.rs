use crate::controllers::auth;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;
use axum::{
    Router, middleware,
    routing::{get, post},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        // Google OAuth
        .route("/google/callback", get(auth::google_callback))
        // Kimi OAuth (Device Flow)
        .route("/kimi/device", post(auth::kimi_device))
        .route("/kimi/token", post(auth::kimi_token_poll))
        .route("/kimi", post(auth::kimi_login))
        // Authenticated endpoints
        .route(
            "/me",
            get(auth::me).layer(middleware::from_fn(jwt_middleware)),
        )
        .route(
            "/stats",
            get(auth::stats).layer(middleware::from_fn(jwt_middleware)),
        )
}
