use crate::controllers::settings;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;
use axum::middleware;
use axum::routing::{MethodRouter, get};

pub fn router() -> MethodRouter<AppState> {
    get(settings::get)
        .put(settings::update)
        .layer(middleware::from_fn(jwt_middleware))
}
