use axum::Router;
use axum::middleware;
use axum::routing::get;

use crate::controllers::coach;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quota", get(coach::quota))
        .route("/scenarios", get(coach::list_scenarios))
        .route(
            "/scenario/draft",
            axum::routing::post(coach::scenario_draft),
        )
        .route("/turn", axum::routing::post(coach::turn))
        .route("/summary", axum::routing::post(coach::summary))
        .route(
            "/interview/profile",
            axum::routing::post(coach::interview_profile),
        )
        .route(
            "/interview/text",
            axum::routing::post(coach::interview_text)
                .layer(axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .layer(middleware::from_fn(jwt_middleware))
}
