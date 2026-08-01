use axum::{
    Extension, Router,
    http::Method,
    http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderName, HeaderValue},
    routing::get,
};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{Level, info, warn};
use tracing_subscriber::FmtSubscriber;

mod controllers;
mod middleware;
mod models;
mod repositories;
mod routes;
mod services;

use crate::middleware::error::AppState;
use crate::repositories::repository_from_env;
use crate::routes::{admin, auth, health, settings, sync, vocabulary};
use crate::services::Services;

fn parse_allowed_origins() -> Vec<HeaderValue> {
    let origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| {
            "http://localhost:4323,http://localhost:5000,http://127.0.0.1:5000,http://localhost:5001,http://127.0.0.1:5001,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
                .to_string()
        });
    origins
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| HeaderValue::from_str(s).expect("Invalid allowed origin in ALLOWED_ORIGINS"))
        .collect()
}

fn build_app(state: AppState) -> Router {
    // CORS configuration
    // Must use explicit origins when allow_credentials(true) is enabled.
    // Set ALLOWED_ORIGINS as a comma-separated list (e.g. "https://app.example.com,https://admin.example.com").
    let cors = CorsLayer::new()
        .allow_origin(parse_allowed_origins())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
        ])
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            ACCEPT,
            HeaderName::from_static("x-requested-with"),
            HeaderName::from_static("x-client-id"),
            HeaderName::from_static("x-admin-token"),
        ])
        .allow_credentials(true);

    Router::new()
        .nest("/api/auth", auth::routes())
        .route("/api/settings", settings::router())
        .route("/api/settings/", settings::router())
        .nest("/api/sync", sync::routes())
        .nest("/api", vocabulary::routes())
        .nest("/api/health", health::routes())
        .nest("/api/admin", admin::routes())
        .route("/", get(root_handler))
        .layer(Extension(state.clone()))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::{build_app, parse_allowed_origins};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tower::ServiceExt;

    use crate::middleware::error::AppState;
    use crate::repositories::SqliteRepositories;
    use crate::services::Services;

    #[test]
    fn default_allowed_origins_include_local_frontend_hosts() {
        unsafe {
            std::env::remove_var("ALLOWED_ORIGINS");
        }

        let origins = parse_allowed_origins()
            .into_iter()
            .map(|value| value.to_str().unwrap().to_string())
            .collect::<Vec<_>>();

        assert!(origins.contains(&"http://localhost:5173".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:5173".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:5000".to_string()));
        assert!(origins.contains(&"http://localhost:5001".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:5001".to_string()));
    }

    #[tokio::test]
    async fn settings_route_matches_with_and_without_trailing_slash() -> anyhow::Result<()> {
        let repository = Arc::new(SqliteRepositories::connect("sqlite::memory:").await?);
        let state = AppState {
            services: Services::new(repository),
            jwt_secret: "test-secret".to_string(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            google_redirect_url: String::new(),
            admin_token: String::new(),
        };
        let app = build_app(state);

        for path in ["/api/settings", "/api/settings/"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header("authorization", "Bearer test-token")
                        .body(Body::empty())?,
                )
                .await?;
            assert_eq!(
                response.status(),
                StatusCode::OK,
                "expected {path} to match the settings route"
            );
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env
    dotenvy::dotenv().ok();

    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .with_thread_ids(true)
        .with_file(false)
        .with_line_number(false)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    info!("Starting Moyan Backend API v{}", env!("CARGO_PKG_VERSION"));

    info!("Initializing repository...");
    let repository = repository_from_env().await?;
    info!(
        backend = repository.backend_name(),
        "Repository initialized"
    );

    let state = AppState {
        services: Services::new(repository),
        jwt_secret: std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "moyan-secret-key-change-in-production".to_string()),
        google_client_id: std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
        google_client_secret: std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
        google_redirect_url: std::env::var("GOOGLE_REDIRECT_URL")
            .unwrap_or_else(|_| "http://localhost:4323/api/auth/google/callback".to_string()),
        admin_token: std::env::var("ADMIN_TOKEN").unwrap_or_default(),
    };

    match state
        .services
        .admin_collect
        .recover_interrupted_jobs()
        .await
    {
        Ok(recovered) if recovered > 0 => {
            info!(jobs = recovered, "Resuming interrupted collect jobs");
        }
        Ok(_) => {}
        Err(err) => {
            warn!("collect job recovery failed: {err:?}");
        }
    }

    // Build router
    let app = build_app(state);

    // Get port
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4323u16);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!("Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn root_handler() -> &'static str {
    "Moyan English Learning API - Rust Backend\nVisit /api/health for status check\n"
}
