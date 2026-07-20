use crate::controllers::settings;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;
use axum::{
    middleware,
    routing::get,
    Router,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(settings::get).put(settings::update))
        .layer(middleware::from_fn(jwt_middleware))
}
