use crate::controllers::health;
use crate::middleware::error::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(health::health_check))
}
