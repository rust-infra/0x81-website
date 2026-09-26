use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};

use crate::controllers::typing;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync", post(typing::sync))
        .route("/stats", get(typing::stats))
        .route(
            "/resume",
            put(typing::put_resume)
                .get(typing::get_resume)
                .delete(typing::delete_resume),
        )
        .route(
            "/mistakes",
            get(typing::list_mistakes).post(typing::sync_mistakes),
        )
        .layer(middleware::from_fn(jwt_middleware))
}
