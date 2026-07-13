// Cargo.toml
// [dependencies]
// axum = "0.8"
// tokio = { version = "1", features = ["full"] }
// tower = "0.5"
// tower-http = { version = "0.6", features = ["trace", "cors", "compression"] }
// tracing = "0.1"
// tracing-subscriber = "0.3"
// serde = { version = "1", features = ["derive"] }
// serde_json = "1"

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Path, Request, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{Level, info};

#[derive(Clone)]
struct AppState {
    db: Arc<Database>, // your DB pool
}

// --- Models ---
#[derive(Serialize)]
struct User {
    id: u64,
    name: String,
}

#[derive(Deserialize)]
struct CreateUser {
    name: String,
}

// --- Error Type ---
#[derive(Debug)]
enum AppError {
    NotFound,
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "Not found".to_string()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error".to_string(),
            ),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

// --- Handlers ---
async fn get_user(
    State(_state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<User>, AppError> {
    // let user = state.db.find_user(id).await?;
    let user = User {
        id,
        name: format!("user-{}", id),
    };
    Ok(Json(user))
}

async fn create_user(
    State(_state): State<AppState>,
    Json(payload): Json<CreateUser>,
) -> Result<Json<User>, AppError> {
    if payload.name.is_empty() {
        return Err(AppError::BadRequest("name cannot be empty".into()));
    }
    let user = User {
        id: 1,
        name: payload.name,
    };
    Ok(Json(user))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn log_request(req: Request, next: middleware::Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = std::time::Instant::now();
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-")
        .to_string();

    let response = next.run(req).await;

    info!(
        "{} {} -> {} ({:?}) - {}",
        method,
        uri,
        response.status(),
        start.elapsed(),
        host
    );

    response
}

static PROXY_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

async fn proxy_or_next(req: Request, next: middleware::Next) -> Response {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if host == "tact.0x81.uk" {
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_TACT");
        proxy_request(req, &upstream,4321).await
    } else {
        next.run(req).await
    }
}

fn proxy_upstream_host(up_stream_host: &'static str) -> String {
    std::env::var(up_stream_host).unwrap_or_else(|_| "127.0.0.1".into())
}

async fn proxy_request(req: Request, up_stream_host: &String, port: i32) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let target_url = format!(
        "http://{up_stream_host}:{port}{}",
        path_and_query
    );

    let body_bytes = match to_bytes(req.into_body(), usize::MAX).await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!("failed to read proxy body: {}", err);
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    let mut proxy_req = PROXY_CLIENT.request(method, &target_url).body(body_bytes);

    for (key, value) in headers.iter() {
        let key_str = key.as_str();
        if is_hop_by_hop_header(key_str) {
            continue;
        }
        proxy_req = proxy_req.header(key_str, value.as_bytes());
    }

    match proxy_req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);

            let mut response_builder = Response::builder().status(status);

            for (key, value) in resp.headers().iter() {
                let key_str = key.as_str();
                if is_hop_by_hop_header(key_str) {
                    continue;
                }
                response_builder = response_builder.header(key_str, value.as_bytes());
            }

            let body_bytes = match resp.bytes().await {
                Ok(bytes) => bytes,
                Err(err) => {
                    tracing::error!("failed to read proxy response body: {}", err);
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };

            response_builder
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(err) => {
            tracing::error!("proxy request failed: {}", err);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

fn is_hop_by_hop_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "keep-alive"
            | "proxy-connection"
            | "transfer-encoding"
            | "upgrade"
            | "te"
            | "trailer"
    )
}

// --- Main ---
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();

    let state = AppState {
        db: Arc::new(Database::new()),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/users/{id}", get(get_user))
        .route("/users", post(create_user))
        .route("/", get(root))
        .layer(middleware::from_fn(log_request))
        .layer(TraceLayer::new_for_http()) // logging
        .layer(middleware::from_fn(proxy_or_next))
        .layer(CompressionLayer::new()) // gzip
        .layer(CorsLayer::permissive()) // CORS
        .with_state(state);

    let listener = TcpListener::bind("0.0.0.0:80").await.unwrap();
    info!("Server listening on {}", listener.local_addr().unwrap());

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    info!("signal received, starting graceful shutdown");
}

// Stub database
struct Database;
impl Database {
    fn new() -> Self {
        Database
    }
}
