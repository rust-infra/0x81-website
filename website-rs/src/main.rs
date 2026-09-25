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
use axum_server::tls_rustls::RustlsConfig;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
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

/// 解析请求的目标主机名（小写、去掉端口）。
///
/// **为什么不能只看 `Host` 头**：HTTP/2 里没有 `Host` 头，authority 在 `:authority`，
/// hyper 会把它放进请求 URI 的 authority（URI 呈绝对形式 `https://host/path`），
/// 于是 `Host` 头为空。Cloudflare 回源默认走 h2，只读 `Host` 头会让**所有 HTTPS 请求**
/// 都匹配不到上游，静默落到本服务的占位路由（`/`、`/health`）——那里返回 200 的
/// `{"status":"ok"}`，看起来像成功，实际整站都变成了这段 JSON。h1 请求则相反：
/// URI 是 origin-form（`/path`，没有 authority），只能靠 `Host` 头。
fn request_host(req: &Request) -> String {
    if let Some(host) = req.uri().host() {
        return host.to_ascii_lowercase();
    }

    let raw = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // h1 的 Host 可能带端口（如 localhost:4321）；只有纯数字端口才剥掉，
    // 免得把 IPv6 字面量（[::1]）切坏。
    match raw.rsplit_once(':') {
        Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => {
            host.to_ascii_lowercase()
        }
        _ => raw.to_ascii_lowercase(),
    }
}

async fn log_request(req: Request, next: middleware::Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = std::time::Instant::now();
    let host = {
        let host = request_host(&req);
        if host.is_empty() { "-".to_string() } else { host }
    };

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
    let host = request_host(&req);
    let host = host.as_str();

    if host == "tact.0x81.uk" {
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_TACT");
        proxy_request(req, &upstream, 4321).await
    } else if host == "crab.0x81.uk" {
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_CRAB");
        proxy_request(req, &upstream, 4322).await
    } else if host == "moyan.0x81.uk" {
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_MOYAN");
        proxy_request(req, &upstream, 5000).await
    } else if host == "admin-moyan.0x81.uk" || host == "admin.moyan.0x81.uk" {
        // 现行域名是 `admin-moyan.0x81.uk`：一层子域，被 Universal SSL 的 *.0x81.uk
        // 覆盖，DNS 已生效、https 可直连。旧名 `admin.moyan.0x81.uk` 是两层子域，
        // *.0x81.uk 覆盖不到（边缘直接握手失败，Full (strict) 下 526），其 DNS 记录
        // 已删除；这里仍然接受它只是零成本兼容，真要恢复可用得重新加记录并配自有证书。
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_MOYAN_ADMIN");
        proxy_request(req, &upstream, 5001).await
    } else if host == "0x81.uk" || host == "www.0x81.uk" {
        let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_INDEX");
        proxy_request(req, &upstream, 4320).await
    } else {
        // 没匹配上任何上游 = 有请求打到了没配置的 Host（或主机名解析又漏了一种情况）。
        // 必须告警：下面落到本服务的占位路由时会返回 200 的 {"status":"ok"}，
        // 表现为"站点打不开但一切正常"，最费时间。健康检查走 localhost，不吵它。
        if !matches!(host, "" | "localhost" | "127.0.0.1" | "[::1]") {
            tracing::warn!("no upstream configured for host {host:?}; falling through to local routes");
        }
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
    let path = uri.path().to_string();

    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let target_url = format!("http://{up_stream_host}:{port}{}", path_and_query);

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
    proxy_req = proxy_req.header("host", format!("localhost:{port}"));

    match proxy_req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let cache_control = cache_control_for(&path, status);

            let mut response_builder = Response::builder().status(status);

            for (key, value) in resp.headers().iter() {
                let key_str = key.as_str();
                if is_hop_by_hop_header(key_str) || key_str.eq_ignore_ascii_case("cache-control")
                {
                    continue;
                }
                response_builder = response_builder.header(key_str, value.as_bytes());
            }

            response_builder = response_builder.header("cache-control", cache_control);

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

/// Conservative Cache-Control for proxied static sites.
/// Astro hashed assets under `/_astro/` are safe to cache forever; HTML stays short.
fn cache_control_for(path: &str, status: StatusCode) -> &'static str {
    if !status.is_success() {
        return "no-store";
    }

    if path.starts_with("/_astro/") {
        return "public, max-age=31536000, immutable";
    }

    let file_name = path.rsplit('/').next().unwrap_or(path);
    let ext = file_name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, ext)| ext.to_ascii_lowercase());

    match ext.as_deref() {
        // Documents: revalidate quickly so deploys show up soon.
        None | Some("html") | Some("htm") => "public, max-age=60, must-revalidate",
        // Low-churn static assets: one day is enough and still conservative.
        Some("svg") | Some("ico") | Some("png") | Some("jpg") | Some("jpeg") | Some("webp")
        | Some("gif") | Some("woff") | Some("woff2") | Some("ttf") | Some("otf") => {
            "public, max-age=86400"
        }
        // Unknown extensions: short browser cache only.
        Some(_) => "public, max-age=60",
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

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to install rustls crypto provider");

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

    let handle = axum_server::Handle::new();
    tokio::spawn({
        let handle = handle.clone();
        async move {
            shutdown_signal().await;
            handle.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
        }
    });

    let http_addr = SocketAddr::from(([0, 0, 0, 0], 80));
    info!("HTTP listening on {}", http_addr);
    let http = axum_server::bind(http_addr)
        .handle(handle.clone())
        .serve(app.clone().into_make_service());

    // Cloudflare Full (strict) needs an HTTPS origin: serve 443 with the
    // Cloudflare Origin Certificate when cert/key paths are provided.
    let tls_paths = std::env::var("TLS_CERT_PATH")
        .ok()
        .zip(std::env::var("TLS_KEY_PATH").ok())
        .filter(|(cert, key)| {
            let both_exist =
                std::path::Path::new(cert).is_file() && std::path::Path::new(key).is_file();
            if !both_exist {
                tracing::warn!("TLS cert/key not found at {cert} / {key}; serving HTTP only");
            }
            both_exist
        });

    match tls_paths {
        Some((cert_path, key_path)) => {
            let tls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
                .await
                .unwrap_or_else(|err| {
                    panic!("failed to load TLS cert/key ({cert_path}, {key_path}): {err}")
                });
            let https_addr = SocketAddr::from(([0, 0, 0, 0], 443));
            info!("HTTPS listening on {}", https_addr);
            let https = axum_server::bind_rustls(https_addr, tls_config)
                .handle(handle)
                .serve(app.into_make_service());

            let (http_result, https_result) = tokio::join!(http, https);
            http_result.unwrap();
            https_result.unwrap();
        }
        None => {
            info!("TLS_CERT_PATH / TLS_KEY_PATH not set; serving HTTP only");
            http.await.unwrap();
        }
    }
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
