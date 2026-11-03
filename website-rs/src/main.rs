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
    extract::Request,
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::get,
};
use axum_server::tls_rustls::RustlsConfig;
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{Level, info};

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
        Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => host.to_ascii_lowercase(),
        _ => raw.to_ascii_lowercase(),
    }
}

async fn log_request(req: Request, next: middleware::Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = std::time::Instant::now();
    let host = {
        let host = request_host(&req);
        if host.is_empty() {
            "-".to_string()
        } else {
            host
        }
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

/// Host →（上游环境变量名，默认端口）。
///
/// **抽成纯函数是为了可测。** 这张表是本服务唯一的业务逻辑，而它出错的表现是
/// 「静默落到占位路由」：`/` 与 `/health` 返回 200 的 `{"status":"ok"}`，其它路径
/// 返回 404——不报错、不告警（只有一条 warn），最费时间的一类故障。下面的测试把
/// 这张表钉住，避免「加了 DNS 但忘了加路由」这种事再发生。
///
/// 端口是默认值：环境变量只覆盖主机名，端口写死在代码里（见 `proxy_upstream_host`）。
fn resolve_upstream(host: &str) -> Option<(&'static str, u16)> {
    match host {
        "tact.0x81.uk" => Some(("PROXY_UPSTREAM_HOST_TACT", 4321)),
        "crab.0x81.uk" => Some(("PROXY_UPSTREAM_HOST_CRAB", 4322)),
        "moyan.0x81.uk" => Some(("PROXY_UPSTREAM_HOST_MOYAN", 5000)),
        // 现行域名是 `admin-moyan.0x81.uk`：一层子域，被 Universal SSL 的 *.0x81.uk
        // 覆盖，DNS 已生效、https 可直连。旧名 `admin.moyan.0x81.uk` 是两层子域，
        // *.0x81.uk 覆盖不到（边缘直接握手失败，Full (strict) 下 526），其 DNS 记录
        // 已删除；这里仍然接受它只是零成本兼容，真要恢复可用得重新加记录并配自有证书。
        "admin-moyan.0x81.uk" | "admin.moyan.0x81.uk" => {
            Some(("PROXY_UPSTREAM_HOST_MOYAN_ADMIN", 5001))
        }
        // 统一登录入口。它和 `moyan.0x81.uk` 现在指向同一个后端，但两者语义不同：
        // 前者是「登录」这个跨产品能力的能力域名，后者是墨言这个产品的产品域名。
        // 客户端（App）只认前者，所以将来 auth 抽成独立服务时，只改这一行，
        // 所有客户端不用发版。
        // 设计：docs/superpowers/specs/2026-10-02-gateway-auth-design.md
        "auth.0x81.uk" => Some(("PROXY_UPSTREAM_AUTH", 4323)),
        // 职演（Rehearse）的入口。现在指向 Web 容器 `rehearse-web`，它内部
        // **也监听 4324**，并把 `/api/rehearse/*` 反代到 `rehearse-backend`。
        // 端口保持 4324 是刻意的：这张表的端口写死在二进制里，改端口要发新的
        // Rust tag；让 Web 容器占用同一个端口，就只需要改 compose 里的上游主机名。
        // 现有 App 打的就是它（`API_URL=https://rehearse.0x81.uk`），路径不变。
        "rehearse.0x81.uk" => Some(("PROXY_UPSTREAM_HOST_REHEARSE", 4324)),
        "0x81.uk" | "www.0x81.uk" => Some(("PROXY_UPSTREAM_HOST_INDEX", 4320)),
        _ => None,
    }
}

async fn proxy_or_next(req: Request, next: middleware::Next) -> Response {
    let host = request_host(&req);

    if let Some((env_key, port)) = resolve_upstream(&host) {
        let upstream = proxy_upstream_host(env_key);
        return proxy_request(req, &upstream, port).await;
    }

    // 没匹配上任何上游 = 有请求打到了没配置的 Host（或主机名解析又漏了一种情况）。
    // 必须告警：下面落到本服务的占位路由时会返回 200 的 {"status":"ok"}（`/`、`/health`）
    // 或 404（其它路径），表现为"站点打不开但一切正常"，最费时间。
    // 健康检查走 localhost，不吵它。
    if !matches!(host.as_str(), "" | "localhost" | "127.0.0.1" | "[::1]") {
        tracing::warn!("no upstream configured for host {host:?}; falling through to local routes");
    }
    next.run(req).await
}

fn proxy_upstream_host(up_stream_host: &'static str) -> String {
    std::env::var(up_stream_host).unwrap_or_else(|_| "127.0.0.1".into())
}

async fn proxy_request(req: Request, up_stream_host: &String, port: u16) -> Response {
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
                if is_hop_by_hop_header(key_str) || key_str.eq_ignore_ascii_case("cache-control") {
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

    // 占位路由：**只服务没匹配上上游的请求**（健康检查走 localhost，还有配错的域名）。
    // 它们的存在让「Host 没配对」这件事不报错，所以 `proxy_or_next` 里的 warn 是唯一信号。
    let app = Router::new()
        .route("/health", get(health))
        .route("/", get(root))
        .layer(middleware::from_fn(log_request))
        .layer(TraceLayer::new_for_http()) // logging
        .layer(middleware::from_fn(proxy_or_next))
        .layer(CompressionLayer::new()) // gzip
        .layer(CorsLayer::permissive()); // CORS

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

#[cfg(test)]
mod tests {
    use super::{request_host, resolve_upstream};
    use axum::body::Body;
    use axum::extract::Request;

    /// h1 请求：URI 是 origin-form，主机名只在 `Host` 头里。
    fn h1_request(host_header: &str) -> Request {
        Request::builder()
            .uri("/api/auth/me")
            .header("host", host_header)
            .body(Body::empty())
            .unwrap()
    }

    /// h2 请求：**没有 `Host` 头**，authority 在 URI 里（hyper 会写成绝对形式）。
    fn h2_request(authority: &str) -> Request {
        Request::builder()
            .uri(format!("https://{authority}/api/auth/me"))
            .body(Body::empty())
            .unwrap()
    }

    /// 路由表必须与 `docker-compose.yml` 里 `website-rs` 的环境变量一一对应。
    /// 加域名时两处都要改——这张表就是那份清单的可执行版本。
    #[test]
    fn routing_table_maps_every_configured_host() {
        for (host, env_key, port) in [
            ("tact.0x81.uk", "PROXY_UPSTREAM_HOST_TACT", 4321u16),
            ("crab.0x81.uk", "PROXY_UPSTREAM_HOST_CRAB", 4322),
            ("moyan.0x81.uk", "PROXY_UPSTREAM_HOST_MOYAN", 5000),
            (
                "admin-moyan.0x81.uk",
                "PROXY_UPSTREAM_HOST_MOYAN_ADMIN",
                5001,
            ),
            // 旧名：零成本兼容，已无 DNS 记录（见 resolve_upstream 的注释）
            (
                "admin.moyan.0x81.uk",
                "PROXY_UPSTREAM_HOST_MOYAN_ADMIN",
                5001,
            ),
            // 统一登录入口，直连后端而不是前端
            ("auth.0x81.uk", "PROXY_UPSTREAM_AUTH", 4323),
            // 职演入口（rehearse-web，内部监听 4324，/api 再反代到后端）
            ("rehearse.0x81.uk", "PROXY_UPSTREAM_HOST_REHEARSE", 4324),
            ("0x81.uk", "PROXY_UPSTREAM_HOST_INDEX", 4320),
            ("www.0x81.uk", "PROXY_UPSTREAM_HOST_INDEX", 4320),
        ] {
            assert_eq!(
                resolve_upstream(host),
                Some((env_key, port)),
                "{host} 的路由丢了——加域名时记得同时改这里和 docker-compose.yml"
            );
        }
    }

    /// 没配的 Host 必须返回 `None`（落到占位路由并打 warn），
    /// 而不是悄悄命中某条分支。
    #[test]
    fn unknown_hosts_have_no_upstream() {
        for host in [
            "",
            "localhost",
            "127.0.0.1",
            "[::1]",
            "example.com",
            "auth.0x81.uk.",
        ] {
            assert_eq!(resolve_upstream(host), None, "{host:?} 不该匹配到上游");
        }
    }

    /// `auth.0x81.uk` 与 `moyan.0x81.uk` 指向**不同的**上游：
    /// 前者是直连后端的能力域名，后者是产品域名（指向前端）。混了就白拆了。
    #[test]
    fn auth_domain_does_not_share_moyan_product_route() {
        assert_ne!(
            resolve_upstream("auth.0x81.uk"),
            resolve_upstream("moyan.0x81.uk")
        );
    }

    /// h1：`Host` 头可能带端口，纯数字端口要剥掉。
    #[test]
    fn request_host_strips_port_from_h1_host_header() {
        assert_eq!(
            request_host(&h1_request("auth.0x81.uk:443")),
            "auth.0x81.uk"
        );
        assert_eq!(request_host(&h1_request("AUTH.0x81.UK")), "auth.0x81.uk");
    }

    /// IPv6 字面量不能被端口剥离逻辑切坏（`[::1]` 里的冒号不是端口分隔符）。
    #[test]
    fn request_host_keeps_ipv6_literal_intact() {
        assert_eq!(request_host(&h1_request("[::1]")), "[::1]");
    }

    /// h2：**没有 `Host` 头**，主机名只能从 URI authority 取。
    /// 这条是整条 HTTPS 流量的命门——只读 `Host` 头会让所有 h2 请求静默落到占位路由。
    #[test]
    fn request_host_falls_back_to_uri_authority_for_h2() {
        assert_eq!(request_host(&h2_request("auth.0x81.uk")), "auth.0x81.uk");
    }
}
