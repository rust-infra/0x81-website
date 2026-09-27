use axum::middleware;
use axum::routing::get;
use axum::Router;

use crate::controllers::coach;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/scenarios", get(coach::list_scenarios))
        .route("/turn", axum::routing::post(coach::turn))
        .route("/summary", axum::routing::post(coach::summary))
        .layer(middleware::from_fn(jwt_middleware))
}
