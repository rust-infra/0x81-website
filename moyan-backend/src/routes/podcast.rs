use axum::{
    routing::{get, post},
    Router,
};

use crate::controllers::podcast;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/resolve", post(podcast::resolve))
        .route("/audio/{video_id}", get(podcast::audio))
}
