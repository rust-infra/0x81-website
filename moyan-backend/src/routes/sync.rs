use crate::controllers::sync;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;
use axum::{
    Router, middleware,
    routing::{get, post},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(sync::upload))
        .route("/download", get(sync::download))
        .route("/status", get(sync::status))
        .layer(middleware::from_fn(jwt_middleware))
}
