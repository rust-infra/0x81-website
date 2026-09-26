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
use crate::routes::{admin, auth, health, podcast, settings, sync, typing, vocabulary};
use crate::services::Services;

fn parse_allowed_origins() -> Vec<HeaderValue> {
    let origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| {
            "http://localhost:4323,http://localhost:5000,http://127.0.0.1:5000,http://localhost:5001,http://127.0.0.1:5001,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:8081,http://127.0.0.1:8081"
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
        .nest("/api/podcast", podcast::routes())
        .route("/api/config", get(crate::controllers::podcast::config))
        .nest("/api/type", typing::routes())
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

    /// Serializes tests that mutate process-global env vars (cache dir, stub
    /// flags) so parallel runs cannot clobber each other.
    static TEST_ENV_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
        assert!(origins.contains(&"http://localhost:8081".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:8081".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:5000".to_string()));
        assert!(origins.contains(&"http://localhost:5001".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:5001".to_string()));
    }

    #[tokio::test]
    async fn settings_route_matches_with_and_without_trailing_slash() -> anyhow::Result<()> {
        let repository = Arc::new(SqliteRepositories::connect("sqlite::memory:").await?);
        let state = test_state(repository);
        let app = build_app(state);

        for path in ["/api/settings", "/api/settings/"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header("authorization", format!("Bearer {}", test_bearer()))
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

    /// 与 `test_state()` 的 `jwt_secret` 配对的真 JWT。
    ///
    /// 这些路由测试原本发的是非 JWT 的 `Bearer test-token`——那是 legacy 兜底路径
    /// 才认的值。`allow_legacy_token_auth` 默认关闭后（见 `middleware::auth`）它们
    /// 全部 401；改成签一个真的 HS256 token，测试才走线上真实的鉴权路径。
    fn test_bearer() -> String {
        test_bearer_for("test-user")
    }

    fn test_bearer_for(sub: &str) -> String {
        use crate::middleware::auth::Claims;
        let claims = Claims {
            sub: sub.to_string(),
            email: "test@example.com".to_string(),
            name: "Test User".to_string(),
            exp: 4_102_444_800, // 2100-01-01，测试用的长期有效值
            iat: 0,
        };
        jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(b"test-secret"),
        )
        .expect("encode test JWT")
    }

    /// 预建一个测试用户并返回它的 id。
    ///
    /// `type_sessions` / `type_resume` 等表对 `users` 有外键，而 sqlx 的 SQLite
    /// 连接默认开启外键强制——只签一个合法 JWT 还不够，被写的行必须真的有主人。
    async fn seed_test_user(state: &AppState) -> String {
        state
            .services
            .auth
            .find_or_create_user(crate::models::UserIdentity {
                provider: "test",
                provider_id: "test-user",
                name: "Test User",
                email: "test@example.com",
                avatar: None,
            })
            .await
            .expect("seed test user")
            .id
    }

    fn test_state(repository: Arc<SqliteRepositories>) -> AppState {
        AppState {
            services: Services::new(repository),
            jwt_secret: "test-secret".to_string(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            google_redirect_url: String::new(),
            google_mobile_client_id: String::new(),
            google_mobile_client_secret: String::new(),
            google_mobile_redirect_url: String::new(),
            admin_token: String::new(),
            telegram_bot_token: String::new(),
            allow_legacy_token_auth: false,
        }
    }

    fn valid_type_payload() -> serde_json::Value {
        serde_json::json!({
            "session": {
                "id": "ts_http_1",
                "deck_id": null,
                "deck_name": "全部词汇",
                "mode": "word",
                "total_cards": 2,
                "completed": 2,
                "skipped": 0,
                "egregious_count": 0,
                "avg_accuracy": 0.9,
                "avg_wpm": 25.0,
                "duration_ms": 60_000,
                "created_at": "2026-08-01T08:00:00Z"
            },
            "entries": [
                {
                    "id": "te_http_1",
                    "card_id": "card_a",
                    "deck_id": "deck_a",
                    "mode": "word",
                    "correct_chars": 9,
                    "wrong_chars": 1,
                    "accuracy": 0.9,
                    "wpm": 25.0,
                    "duration_ms": 4_000,
                    "egregious": false,
                    "created_at": "2026-08-01T08:00:04Z"
                }
            ]
        })
    }

    async fn read_json(response: axum::response::Response) -> anyhow::Result<serde_json::Value> {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    #[tokio::test]
    async fn type_sync_saves_session_and_entries() -> anyhow::Result<()> {
        let state = test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        ));
        let sub = seed_test_user(&state).await;
        let app = build_app(state);
        let bearer = format!("Bearer {}", test_bearer_for(&sub));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_type_payload())?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);

        let body = read_json(response).await?;
        assert_eq!(body["data"]["saved_session"], true);
        assert_eq!(body["data"]["saved_entries"], 1);
        Ok(())
    }

    #[tokio::test]
    async fn type_sync_rejects_invalid_mode_with_400() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let mut payload = valid_type_payload();
        payload["session"]["mode"] = serde_json::json!("typing");
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", format!("Bearer {}", test_bearer()))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[tokio::test]
    async fn type_sync_rejects_out_of_range_accuracy_with_400() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let mut payload = valid_type_payload();
        payload["entries"][0]["accuracy"] = serde_json::json!(1.5);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", format!("Bearer {}", test_bearer()))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[tokio::test]
    async fn type_stats_returns_practiced_mastery() -> anyhow::Result<()> {
        let repository = Arc::new(SqliteRepositories::connect("sqlite::memory:").await?);
        let state = test_state(repository.clone());
        let sub = seed_test_user(&state).await;
        let app = build_app(state);
        let bearer = format!("Bearer {}", test_bearer_for(&sub));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_type_payload())?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/type/stats")
                    .header("authorization", bearer.clone())
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert_eq!(body["data"]["recent_sessions"].as_array().unwrap().len(), 1);
        assert_eq!(body["data"]["mastery"].as_array().unwrap().len(), 1);
        let mastery = &body["data"]["mastery"][0];
        assert_eq!(mastery["card_id"], "card_a");
        assert!(mastery["score"].as_f64().unwrap() > 0.0);
        Ok(())
    }

    #[tokio::test]
    async fn type_mistakes_sync_and_list_round_trip() -> anyhow::Result<()> {
        let repository = Arc::new(SqliteRepositories::connect("sqlite::memory:").await?);
        let state = test_state(repository.clone());
        let sub = seed_test_user(&state).await;
        let deck = state
            .services
            .vocabulary
            .create_deck(
                &sub,
                crate::models::CreateDeckRequest {
                    name: "错题本测试".into(),
                    description: None,
                    color: None,
                },
            )
            .await
            .expect("create deck");
        let card = state
            .services
            .vocabulary
            .create_card(
                &sub,
                &deck.id,
                crate::models::CreateCardRequest {
                    front: "hello".into(),
                    back: "你好".into(),
                    pronunciation: None,
                    tags: None,
                    examples: None,
                },
            )
            .await
            .expect("create card");
        let app = build_app(state);
        let bearer = format!("Bearer {}", test_bearer_for(&sub));

        // 打错一个词 → 进错题本
        let payload = serde_json::json!({
            "add": [{ "card_id": card.id, "deck_id": deck.id, "entry_id": "te_m1" }],
            "remove": []
        });
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/mistakes")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert_eq!(body["data"]["added"], 1);
        assert_eq!(body["data"]["removed"], 0);
        assert_eq!(body["data"]["total"], 1);

        // 重试同一批 → 幂等：不重复计数，且响应里能看到被去重的条数
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/mistakes")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert_eq!(body["data"]["deduplicated"], 1);
        assert_eq!(body["data"]["total"], 1);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/type/mistakes")
                    .header("authorization", bearer.clone())
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        let items = body["data"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["card"]["front"], "hello");
        assert_eq!(items[0]["wrong_count"], 1);

        // 打到 100% 准确率 → 移出错题本
        let payload = serde_json::json!({
            "add": [],
            "remove": [card.id]
        });
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/mistakes")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert_eq!(body["data"]["removed"], 1);
        assert_eq!(body["data"]["total"], 0);
        Ok(())
    }

    fn valid_resume_payload() -> serde_json::Value {
        serde_json::json!({
            "deck_id": "deck_resume",
            "deck_name": "Rust语言核心",
            "mode": "word",
            "card_id": "card_resume",
            "target": "hello",
            "char_index": 3,
            "correct_chars": 2,
            "wrong_chars": 1,
            "typed_states": [
                { "state": "correct", "input_char": "h" },
                { "state": "wrong", "input_char": "x" },
                { "state": "correct", "input_char": "l" }
            ],
            "updated_at": "2026-08-01T08:30:00Z"
        })
    }

    #[tokio::test]
    async fn type_resume_put_get_delete_round_trip() -> anyhow::Result<()> {
        let state = test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        ));
        let sub = seed_test_user(&state).await;
        let app = build_app(state);
        let bearer = format!("Bearer {}", test_bearer_for(&sub));
        let put = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/type/resume")
                    .header("authorization", bearer.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_resume_payload())?))?,
            )
            .await?;
        assert_eq!(put.status(), StatusCode::OK);

        let get = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/type/resume?deck_id=deck_resume")
                    .header("authorization", bearer.clone())
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(get.status(), StatusCode::OK);
        let body = read_json(get).await?;
        assert_eq!(body["data"]["resume"]["card_id"], "card_resume");
        assert_eq!(body["data"]["resume"]["char_index"], 3);
        assert_eq!(body["data"]["resume"]["typed_states"].as_array().unwrap().len(), 3);

        let del = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/type/resume?deck_id=deck_resume")
                    .header("authorization", bearer.clone())
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(del.status(), StatusCode::OK);

        let get_after = app
            .oneshot(
                Request::builder()
                    .uri("/api/type/resume?deck_id=deck_resume")
                    .header("authorization", bearer.clone())
                    .body(Body::empty())?,
            )
            .await?;
        let body = read_json(get_after).await?;
        assert!(body["data"]["resume"].is_null());
        Ok(())
    }

    #[tokio::test]
    async fn type_resume_rejects_invalid_mode_with_400() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let mut payload = valid_resume_payload();
        payload["mode"] = serde_json::json!("typing");
        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/type/resume")
                    .header("authorization", format!("Bearer {}", test_bearer()))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[tokio::test]
    async fn study_daily_trend_route_returns_points() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/study/daily-trend?days=7")
                    .header("authorization", format!("Bearer {}", test_bearer()))
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert!(body["data"].is_array());
        Ok(())
    }

    #[tokio::test]
    async fn google_mobile_login_requires_server_config() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/google/mobile")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&serde_json::json!({
                        "code": "test-code"
                    }))?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = read_json(response).await?;
        assert!(
            body["error"]["message"]
                .as_str()
                .unwrap_or("")
                .contains("not configured")
        );
        Ok(())
    }

    #[tokio::test]
    async fn podcast_config_returns_feature_flag() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/config")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json(response).await?;
        assert_eq!(body["data"]["podcast"]["app_enabled"], false);
        assert_eq!(body["data"]["podcast"]["web_enabled"], false);
        assert_eq!(body["data"]["podcast"]["youtube_api_key"], "");
        Ok(())
    }

    #[tokio::test]
    async fn podcast_resolve_caches_audio_and_captions() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let cache = std::env::temp_dir().join(format!(
            "moyan-podcast-test-{}",
            uuid::Uuid::new_v4()
        ));
        unsafe {
            std::env::set_var("PODCAST_CACHE_DIR", &cache);
            std::env::set_var("MOYAN_COLLECT_STUB", "1");
        }
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let payload = serde_json::json!({
            "url": "https://www.youtube.com/watch?v=LqG1q5NpOBE"
        });
        let make_post = || {
            app.clone().oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/podcast/resolve")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
        };

        let first = make_post().await?;
        assert_eq!(first.status(), StatusCode::OK);
        let body = read_json(first).await?;
        assert_eq!(body["data"]["video_id"], "LqG1q5NpOBE");
        assert!(
            body["data"]["captions"].as_array().unwrap().len() >= 3,
            "stub captions should be parsed"
        );
        assert_eq!(
            body["data"]["audio_url"],
            "/api/podcast/audio/LqG1q5NpOBE"
        );

        // cache hit: second resolve still succeeds
        let second = make_post().await?;
        assert_eq!(second.status(), StatusCode::OK);

        // audio stream serves the cached file
        let audio = app
            .oneshot(
                Request::builder()
                    .uri("/api/podcast/audio/LqG1q5NpOBE")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(audio.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(audio.into_body(), usize::MAX).await?;
        assert_eq!(bytes.as_ref(), b"stub-audio");

        unsafe {
            std::env::remove_var("PODCAST_CACHE_DIR");
            std::env::remove_var("MOYAN_COLLECT_STUB");
        }
        let _ = std::fs::remove_dir_all(&cache);
        Ok(())
    }

    #[tokio::test]
    async fn podcast_translate_returns_translations_for_cached_video() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let cache = std::env::temp_dir().join(format!(
            "moyan-podcast-translate-test-{}",
            uuid::Uuid::new_v4()
        ));
        unsafe {
            std::env::set_var("PODCAST_CACHE_DIR", &cache);
            std::env::set_var("MOYAN_COLLECT_STUB", "1");
        }
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let payload = serde_json::json!({
            "url": "https://www.youtube.com/watch?v=LqG1q5NpOBE"
        });
        let resolve = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/podcast/resolve")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await?;
        assert_eq!(resolve.status(), StatusCode::OK);

        let translate = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/podcast/translate/LqG1q5NpOBE")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(translate.status(), StatusCode::OK);
        let body = read_json(translate).await?;
        let translations = body["data"]["translations"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("translations should be an array"))?;
        assert!(
            translations.len() >= 3,
            "stub translations should cover every caption line"
        );
        assert!(translations.iter().all(|t| t.as_str().unwrap_or("").len() > 0));

        // cached translation request still succeeds
        let second = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/podcast/translate/LqG1q5NpOBE")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(second.status(), StatusCode::OK);

        unsafe {
            std::env::remove_var("PODCAST_CACHE_DIR");
            std::env::remove_var("MOYAN_COLLECT_STUB");
        }
        let _ = std::fs::remove_dir_all(&cache);
        Ok(())
    }

    /// 设置一个环境变量，测试结束（含 panic）时自动清掉。
    struct EnvGuard(&'static str);

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe { std::env::remove_var(self.0) }
        }
    }

    /// 一个假的 Kimi：`/api/oauth/token` 返回给定的授权结果，
    /// `/api/oauth/userinfo` 按 `verified` 放行或 401。
    async fn start_kimi_stub(access_token: Option<&str>, verified: bool) -> String {
        use axum::{
            Json, Router,
            routing::{get, post},
        };

        let token_body = match access_token {
            Some(token) => serde_json::json!({ "access_token": token, "token_type": "Bearer" }),
            None => serde_json::json!({ "error": "authorization_pending" }),
        };
        let userinfo_body = if verified {
            serde_json::json!({ "sub": "kimi-user-1", "name": "Kimi User", "email": "k@kimi.user" })
        } else {
            serde_json::json!({ "code": "unauthenticated" })
        };

        let app = Router::new()
            .route(
                "/api/oauth/token",
                post(move || {
                    let body = token_body.clone();
                    async move { Json(body) }
                }),
            )
            .route(
                "/api/oauth/userinfo",
                get(move || {
                    let body = userinfo_body.clone();
                    let status = if verified {
                        StatusCode::OK
                    } else {
                        StatusCode::UNAUTHORIZED
                    };
                    async move { (status, Json(body)) }
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind kimi stub");
        let addr = listener.local_addr().expect("kimi stub addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{addr}")
    }

    fn kimi_poll_request(device_code: &str) -> anyhow::Result<Request<Body>> {
        Ok(Request::builder()
            .method("POST")
            .uri("/api/auth/kimi/token")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(
                &serde_json::json!({ "device_code": device_code, "device_id": "d-1" }),
            )?))?)
    }

    /// 假 Kimi，模拟 2026-09-18 的上游故障：`/api/oauth/userinfo` 拒收 Kimi **自家**
    /// 刚签发的 ES256 token，而 `/api/oauth/token` 的 refresh_token 校验正常
    /// （由 `refresh_accepted` 决定是否放行）。
    async fn start_kimi_es256_stub(refresh_accepted: bool, access_token: &str) -> String {
        use axum::{
            Json, Router,
            body::Bytes,
            routing::{get, post},
        };

        let access_token = access_token.to_string();
        let app = Router::new()
            .route(
                "/api/oauth/token",
                post(move |body: Bytes| {
                    let access_token = access_token.clone();
                    async move {
                        // refresh 复核请求 vs. device flow 轮询请求，按 grant_type 区分。
                        if String::from_utf8_lossy(&body).contains("grant_type=refresh_token") {
                            let status = if refresh_accepted {
                                StatusCode::OK
                            } else {
                                StatusCode::UNAUTHORIZED
                            };
                            let body = if refresh_accepted {
                                serde_json::json!({
                                    "access_token": access_token,
                                    "token_type": "Bearer",
                                })
                            } else {
                                serde_json::json!({ "error": "invalid_grant" })
                            };
                            (status, Json(body))
                        } else {
                            (
                                StatusCode::OK,
                                Json(serde_json::json!({
                                    "access_token": access_token,
                                    "refresh_token": "kimi-refresh-token",
                                    "token_type": "Bearer",
                                    "expires_in": 900,
                                    "scope": "kimi-code",
                                })),
                            )
                        }
                    }
                }),
            )
            .route(
                "/api/oauth/userinfo",
                get(|| async {
                    (
                        StatusCode::UNAUTHORIZED,
                        Json(serde_json::json!({
                            "code": "unauthenticated",
                            "message": "invalid user token: token signature is invalid: \
                                        signing method ES256 is invalid",
                            "details": [{}],
                        })),
                    )
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind kimi stub");
        let addr = listener.local_addr().expect("kimi stub addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{addr}")
    }

    /// 构造一个 Kimi 形态的 access token（`alg: ES256` + 给定 claims）。
    /// 签名是假的——我们本地不验签，真实性由 stub 的 refresh 复核代表。
    fn es256_access_token(sub: &str, iss: &str, token_type: &str) -> String {
        fn b64url(input: &str) -> String {
            const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            let bytes = input.as_bytes();
            let mut out = String::new();
            for chunk in bytes.chunks(3) {
                let b = [
                    chunk[0],
                    *chunk.get(1).unwrap_or(&0),
                    *chunk.get(2).unwrap_or(&0),
                ];
                let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
                out.push(TABLE[(n >> 18) as usize & 63] as char);
                out.push(TABLE[(n >> 12) as usize & 63] as char);
                if chunk.len() > 1 {
                    out.push(TABLE[(n >> 6) as usize & 63] as char);
                }
                if chunk.len() > 2 {
                    out.push(TABLE[n as usize & 63] as char);
                }
            }
            out
        }

        let header = b64url(
            &serde_json::json!({
                "alg": "ES256",
                "kid": "d4cbb48f550952c67a011c2e98dee27fad4325fb",
                "typ": "JWT",
            })
            .to_string(),
        );
        let payload = b64url(
            &serde_json::json!({
                "client_id": "17e5f671-d194-4dfb-9706-5516cb48c098",
                "user_id": sub,
                "scope": "kimi-code",
                "type": token_type,
                "iss": iss,
                "sub": sub,
                "exp": 4102444800u64,
                "nbf": 0,
                "iat": 0,
                "jti": "j-1",
            })
            .to_string(),
        );
        format!("{header}.{payload}.c2ln")
    }

    /// 回归（2026-09-18 上游故障）：Kimi 的 userinfo 拒收自家 ES256 token 时，登录改走
    /// refresh_token 复核——仍由 Kimi 复核，仍只把**我们自己的** JWT 回给客户端。
    #[tokio::test]
    async fn kimi_login_falls_back_to_refresh_verification_when_userinfo_rejects_es256()
    -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let kimi_token = es256_access_token("kimi-user-1", "kimi-auth", "access");
        let base = start_kimi_es256_stub(true, &kimi_token).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app.clone().oneshot(kimi_poll_request("dc-es256")?).await?;
        assert_eq!(response.status(), StatusCode::OK);

        let body = read_json(response).await?;
        let token = body["data"]["token"]
            .as_str()
            .expect("backend token in response")
            .to_string();
        assert!(
            !body.to_string().contains(&kimi_token),
            "响应体里不应出现 Kimi 的 access_token"
        );
        // 身份取自 token 的 `sub`（userinfo 不可用，只有占位资料）。
        assert_eq!(body["data"]["user"]["name"], "Kimi User");
        assert_eq!(body["data"]["user"]["email"], "kimi-use@kimi.user");

        // 回给客户端的必须是我们自己签的 JWT。
        let me = app
            .oneshot(
                Request::builder()
                    .uri("/api/auth/me")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(me.status(), StatusCode::OK);
        Ok(())
    }

    /// refresh 兜底**不是**无条件信任：Kimi 不认 refresh_token 时仍然 401。
    #[tokio::test]
    async fn kimi_login_still_401_when_refresh_verification_fails() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let kimi_token = es256_access_token("kimi-user-1", "kimi-auth", "access");
        let base = start_kimi_es256_stub(false, &kimi_token).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app.oneshot(kimi_poll_request("dc-es256-bad")?).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        Ok(())
    }

    /// refresh 通过也不代表 claims 可以乱信：issuer / token 类型不对照样拒绝。
    #[tokio::test]
    async fn kimi_refresh_fallback_rejects_foreign_issuer_tokens() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let foreign = es256_access_token("kimi-user-1", "evil-issuer", "access");
        let base = start_kimi_es256_stub(true, &foreign).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app.oneshot(kimi_poll_request("dc-es256-iss")?).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        Ok(())
    }

    /// 回归（2026-09-19 事故）：兜底路径**没有**任何资料，不能把已有账号的昵称 /
    /// 邮箱 / 头像写回占位值。
    ///
    /// 事故原样：`find_or_create` 是 upsert，而兜底路径只能用 `Kimi User` /
    /// `{sub 前 8 字符}@kimi.user` 占位，于是 userinfo 坏着的每一天，每次 Kimi 登录
    /// 都会把该账号的资料覆盖成占位值——手工改名改不牢。
    #[tokio::test]
    async fn kimi_refresh_fallback_keeps_existing_profile() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let kimi_token = es256_access_token("kimi-user-1", "kimi-auth", "access");
        let base = start_kimi_es256_stub(true, &kimi_token).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let state = test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        ));
        // 先有一个资料完整的账号（上游正常时登录过 / 用户改过昵称）。
        state
            .services
            .auth
            .find_or_create_user(crate::models::UserIdentity {
                provider: "kimi",
                provider_id: "kimi-user-1",
                name: "张三",
                email: "zhangsan@example.com",
                avatar: Some("https://img.example.com/a.png"),
            })
            .await?;

        let app = build_app(state);
        let response = app.clone().oneshot(kimi_poll_request("dc-es256-keep")?).await?;
        assert_eq!(response.status(), StatusCode::OK);

        let body = read_json(response).await?;
        assert_eq!(body["data"]["user"]["name"], "张三");
        assert_eq!(body["data"]["user"]["email"], "zhangsan@example.com");
        assert_eq!(
            body["data"]["user"]["avatar"],
            "https://img.example.com/a.png"
        );
        assert_eq!(body["data"]["user"]["provider"], "kimi");
        Ok(())
    }

    /// 反向约束：上游恢复、userinfo 又能给出真资料时，仍然要覆盖库里的旧值——不能
    /// 因为"保护已有资料"就把账号永久钉在占位值上。
    #[tokio::test]
    async fn kimi_userinfo_profile_still_overwrites_stored_values() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let base = start_kimi_stub(Some("kimi-access-token"), true).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let state = test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        ));
        state
            .services
            .auth
            .find_or_create_user(crate::models::UserIdentity {
                provider: "kimi",
                provider_id: "kimi-user-1",
                name: "旧昵称",
                email: "old@example.com",
                avatar: None,
            })
            .await?;

        let app = build_app(state);
        let response = app.oneshot(kimi_poll_request("dc-1")?).await?;
        assert_eq!(response.status(), StatusCode::OK);

        // stub 的 userinfo 返回 name="Kimi User"、email="k@kimi.user"。
        let body = read_json(response).await?;
        assert_eq!(body["data"]["user"]["name"], "Kimi User");
        assert_eq!(body["data"]["user"]["email"], "k@kimi.user");
        Ok(())
    }

    /// 现行登录路径：轮询拿到 Kimi 的 access_token 后由**服务端**去 userinfo 复核，
    /// 只把我们的 JWT 回给客户端——Kimi 的 access_token 不离开服务端。
    #[tokio::test]
    async fn kimi_token_poll_returns_our_jwt_and_never_the_kimi_token() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let base = start_kimi_stub(Some("kimi-access-token"), true).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app.clone().oneshot(kimi_poll_request("dc-1")?).await?;
        assert_eq!(response.status(), StatusCode::OK);

        let body = read_json(response).await?;
        let token = body["data"]["token"]
            .as_str()
            .expect("backend token in response")
            .to_string();
        assert_ne!(
            token, "kimi-access-token",
            "不能把 Kimi 的 access_token 当成我们的 JWT 回传"
        );
        assert!(
            !body.to_string().contains("kimi-access-token"),
            "响应体里不应出现 Kimi 的 access_token"
        );
        assert_eq!(body["data"]["user"]["name"], "Kimi User");

        // 这个 token 必须是**我们自己签的**：能过 jwt_middleware。
        let me = app
            .oneshot(
                Request::builder()
                    .uri("/api/auth/me")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(me.status(), StatusCode::OK);
        Ok(())
    }

    /// 回归：Kimi 不认的 token（伪造 / 过期）必须 401。
    ///
    /// 这条钉住的正是 2026-09-18 的漏洞——原先 `POST /api/auth/kimi` 本地解 JWT 取
    /// `sub`，自签一个 token 就能冒充任何人。
    #[tokio::test]
    async fn kimi_token_poll_rejects_a_token_kimi_would_not_verify() -> anyhow::Result<()> {
        let _guard = TEST_ENV_MUTEX.lock().await;
        let base = start_kimi_stub(Some("forged-token"), false).await;
        unsafe { std::env::set_var("MOYAN_KIMI_BASE_URL", &base) };
        let _env = EnvGuard("MOYAN_KIMI_BASE_URL");

        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app.oneshot(kimi_poll_request("dc-2")?).await?;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        Ok(())
    }

    /// 旧接口必须保持关闭：它不验签，任何人自签 `sub` 即可接管账号。
    #[tokio::test]
    async fn kimi_login_endpoint_is_gone() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/kimi")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(
                        &serde_json::json!({ "access_token": "forged" }),
                    )?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::GONE);
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
        google_mobile_client_id: std::env::var("GOOGLE_MOBILE_CLIENT_ID").unwrap_or_default(),
        google_mobile_client_secret: std::env::var("GOOGLE_MOBILE_CLIENT_SECRET").unwrap_or_default(),
        google_mobile_redirect_url: std::env::var("GOOGLE_MOBILE_REDIRECT_URL").unwrap_or_default(),
        admin_token: std::env::var("ADMIN_TOKEN").unwrap_or_default(),
        telegram_bot_token: std::env::var("TELEGRAM_BOT_TOKEN").unwrap_or_default(),
        // 默认关闭：非 JWT 的 Bearer 值会被拒绝（不能自动建号）。
        // 只有 dev-run.sh 这类本地开发环境才导出 ALLOW_LEGACY_TOKEN_AUTH=1。
        allow_legacy_token_auth: crate::middleware::auth::legacy_token_auth_allowed(
            &std::env::var("ALLOW_LEGACY_TOKEN_AUTH").unwrap_or_default(),
        ),
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
