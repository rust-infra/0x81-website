use crate::controllers::admin;
use crate::middleware::admin_auth::admin_token_middleware;
use crate::middleware::error::AppState;
use axum::{Router, middleware, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ping", get(admin::ping))
        .layer(middleware::from_fn(admin_token_middleware))
}
