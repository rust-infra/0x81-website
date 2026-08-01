use axum::{
    middleware,
    routing::{get, post},
    Router,
};

use crate::controllers::typing;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync", post(typing::sync))
        .route("/stats", get(typing::stats))
        .layer(middleware::from_fn(jwt_middleware))
}
