use crate::config::{Config, SCHEMA_VERSION};
use crate::store::{PaymentAttempt, PriceRule, Store, StoreError, UsageEvent};
use crate::x402::{
    Facilitator, PaymentRequired, PaymentRequirements, ResourceInfo, decode_payment_header,
    encode_payment_required, encode_settle_result, payload_hash, validate_payment,
};
use axum::{
    Extension, Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header::CACHE_CONTROL},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use uuid::Uuid;

const MAX_BODY_BYTES: usize = 1 << 20;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub store: Store,
    pub facilitator: Arc<dyn Facilitator>,
    pub health: Arc<Mutex<HealthCache>>,
}

#[derive(Default)]
pub struct HealthCache {
    checked_at: Option<Instant>,
    ok: bool,
}

#[derive(Clone)]
pub struct RequestId(pub String);

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("payment-signature"),
            HeaderName::from_static("x-payment"),
            HeaderName::from_static("x-admin-token"),
        ])
        .expose_headers([
            HeaderName::from_static("payment-required"),
            HeaderName::from_static("payment-response"),
            HeaderName::from_static("x-payment-response"),
            HeaderName::from_static("x-request-id"),
        ]);

    Router::new()
        .route("/health", get(health))
        .route("/v1/models", get(models))
        .route("/v1/echo", post(echo))
        .route("/admin/payments/{request_id}", get(get_payment))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(request_context))
        .with_state(state)
}

async fn request_context(mut request: Request, next: Next) -> Response {
    let request_id = format!("req_{}", Uuid::new_v4());
    request
        .extensions_mut()
        .insert(RequestId(request_id.clone()));

    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = Instant::now();
    let mut response = next.run(request).await;

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = response.status().as_u16(),
        duration_ms = started.elapsed().as_millis(),
        "request"
    );
    response
}

async fn health(State(state): State<AppState>) -> Response {
    let db_ok = state.store.ping().await.is_ok();
    let version = state.store.schema_version().await.unwrap_or(0);
    let facilitator_ok = check_facilitator(&state).await;
    let ok = db_ok && version >= SCHEMA_VERSION && facilitator_ok;

    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = json!({
        "status": if ok { "ok" } else { "degraded" },
        "database": if db_ok { "ok" } else { "unreachable" },
        "schema_version": version,
        "expected_schema_version": SCHEMA_VERSION,
        "facilitator": if facilitator_ok { "ok" } else { "unreachable" },
    });
    (status, Json(body)).into_response()
}

async fn check_facilitator(state: &AppState) -> bool {
    let mut cache = state.health.lock().await;
    if let Some(checked_at) = cache.checked_at {
        if checked_at.elapsed() < Duration::from_secs(60) {
            return cache.ok;
        }
    }
    let ok = state.facilitator.supported().await.is_ok();
    cache.checked_at = Some(Instant::now());
    cache.ok = ok;
    ok
}

async fn models(State(state): State<AppState>) -> Response {
    match state.store.prices().await {
        Ok(rules) => ok_response(json!(rules)),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "cannot read prices"),
    }
}

async fn echo(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let started = Instant::now();

    let echo: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return error_response(StatusCode::BAD_REQUEST, "request body must be valid JSON");
        }
    };

    let rule = match state.store.price_for("echo").await {
        Ok(rule) => rule,
        Err(_) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "price is not configured");
        }
    };
    let reqs = vec![requirements(&state.config, &rule)];

    let (raw, payload) = match decode_payment_header(&headers) {
        Ok(value) => value,
        Err(_) => return challenge_response(&reqs, "payment required", &state.config),
    };

    let auth = match validate_payment(&payload, &reqs[0], &state.config.pay_to, rule.price_atomic) {
        Ok(auth) => auth,
        Err(err) => return challenge_response(&reqs, &err, &state.config),
    };

    let payer_lower = auth.from.to_lowercase();
    let nonce_lower = auth.nonce.to_lowercase();
    match state
        .store
        .nonce_exists(
            &state.config.network,
            &state.config.asset,
            &payer_lower,
            &nonce_lower,
        )
        .await
    {
        Ok(true) => {
            return error_response(StatusCode::CONFLICT, "payment has already been used");
        }
        Ok(false) => {}
        Err(_) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "cannot read payment ledger",
            );
        }
    }

    let verify = match state.facilitator.verify(&payload, &reqs[0]).await {
        Ok(verify) => verify,
        Err(_) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "payment verification is unavailable",
            );
        }
    };
    if !verify.is_valid {
        return challenge_response(
            &reqs,
            verify
                .invalid_reason
                .as_deref()
                .unwrap_or("payment is invalid"),
            &state.config,
        );
    }
    let payer = match verify.payer {
        Some(payer) if payer.eq_ignore_ascii_case(&auth.from) => payer.to_lowercase(),
        _ => return challenge_response(&reqs, "payer mismatch", &state.config),
    };

    let now = Utc::now();
    let attempt = PaymentAttempt {
        request_id: request_id.0.clone(),
        payer,
        network: state.config.network.clone(),
        asset: state.config.asset.clone(),
        nonce: nonce_lower,
        amount_atomic: rule.price_atomic,
        pay_to: state.config.pay_to.clone(),
        status: "verified".to_string(),
        payload_hash: payload_hash(&raw),
        valid_before: DateTime::from_timestamp(auth.valid_before, 0).unwrap_or(now),
        tx_hash: None,
        invalid_reason: None,
        created_at: now,
        verified_at: Some(now),
        settled_at: None,
        served_at: None,
    };

    match state.store.insert_attempt(&attempt).await {
        Ok(()) => {}
        Err(StoreError::DuplicateNonce) => {
            return error_response(StatusCode::CONFLICT, "payment has already been used");
        }
        Err(StoreError::PayerBusy) => {
            return error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "payer already has an in-flight payment",
            );
        }
        Err(_) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "cannot record payment");
        }
    }

    if state
        .store
        .mark_settling(&attempt.request_id)
        .await
        .is_err()
    {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot update payment state",
        );
    }

    let settle = tokio::time::timeout(
        Duration::from_secs(state.config.facilitator_timeout_secs * 2),
        state.facilitator.settle(&payload, &reqs[0]),
    )
    .await;

    let settle = match settle {
        Ok(Ok(settle)) => settle,
        Ok(Err(_)) | Err(_) => {
            let _ = state
                .store
                .mark_settle_failed(&attempt.request_id, "settle failed")
                .await;
            return error_response(StatusCode::BAD_GATEWAY, "payment settlement failed");
        }
    };
    if !settle.success {
        let _ = state
            .store
            .mark_settle_failed(
                &attempt.request_id,
                settle.error_reason.as_deref().unwrap_or("settle failed"),
            )
            .await;
        return error_response(StatusCode::BAD_GATEWAY, "payment settlement failed");
    }

    if state
        .store
        .mark_settled(&attempt.request_id, &settle.transaction)
        .await
        .is_err()
    {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "payment settled but ledger update failed",
        );
    }

    let _ = state.store.mark_served(&attempt.request_id).await;
    let _ = state
        .store
        .record_usage(&UsageEvent {
            request_id: attempt.request_id.clone(),
            model: "echo".to_string(),
            price_atomic: rule.price_atomic,
            status: "served".to_string(),
            latency_ms: started.elapsed().as_millis() as i64,
            created_at: Utc::now(),
        })
        .await;

    let mut response = ok_response(json!({
        "request_id": attempt.request_id,
        "payer": attempt.payer,
        "echo": echo,
    }));
    if let Ok(encoded) = encode_settle_result(&settle) {
        if let Ok(value) = HeaderValue::from_str(&encoded) {
            response
                .headers_mut()
                .insert(HeaderName::from_static("payment-response"), value.clone());
            response
                .headers_mut()
                .insert(HeaderName::from_static("x-payment-response"), value);
        }
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn get_payment(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if state.config.admin_token.is_empty() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "admin token is not configured",
        );
    }
    let provided = headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if provided != state.config.admin_token {
        return error_response(StatusCode::UNAUTHORIZED, "invalid admin token");
    }

    match state.store.get_attempt(&request_id).await {
        Ok(attempt) => ok_response(json!(attempt)),
        Err(StoreError::NotFound) => error_response(StatusCode::NOT_FOUND, "payment not found"),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "cannot read payment"),
    }
}

fn requirements(config: &Config, rule: &PriceRule) -> PaymentRequirements {
    let amount = rule.price_atomic.to_string();
    let extra = if config.asset_transfer_method == "permit2" {
        json!({"assetTransferMethod": "permit2"})
    } else {
        json!({"name": config.asset_name, "version": config.asset_version})
    };
    PaymentRequirements {
        scheme: "exact".to_string(),
        network: config.network.clone(),
        asset: config.asset.clone(),
        amount,
        pay_to: config.pay_to.clone(),
        max_timeout_seconds: 60,
        extra: extra.as_object().cloned().unwrap_or_default(),
    }
}

fn challenge_response(reqs: &[PaymentRequirements], message: &str, config: &Config) -> Response {
    let body = PaymentRequired {
        x402_version: 2,
        error: Some(message.to_string()),
        resource: ResourceInfo {
            url: format!("{}/v1/echo", config.public_base_url),
            description: Some("x402 echo endpoint".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        accepts: reqs.to_vec(),
        extensions: None,
    };
    let mut response = (StatusCode::PAYMENT_REQUIRED, Json(body.clone())).into_response();

    if let Ok(encoded) = encode_payment_required(&body) {
        if let Ok(value) = HeaderValue::from_str(&encoded) {
            response
                .headers_mut()
                .insert(HeaderName::from_static("payment-required"), value);
        }
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn ok_response(data: Value) -> Response {
    Json(json!({"success": true, "data": data})).into_response()
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({
            "success": false,
            "error": {"code": status.as_u16(), "message": message}
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::x402::{FacilitatorError, Kind, SettleResult, VerifyResult};
    use async_trait::async_trait;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use serde_json::json;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;
    use tower::ServiceExt;

    const TEST_PAY_TO: &str = "0x1111111111111111111111111111111111111111";
    const TEST_ASSET: &str = "0x2222222222222222222222222222222222222222";
    const TEST_PAYER: &str = "0x3333333333333333333333333333333333333333";
    const TEST_ADMIN: &str = "test-admin-token";

    struct FakeFacilitator {
        verify: StdMutex<VerifyResult>,
        settle: StdMutex<SettleResult>,
        verify_calls: AtomicUsize,
    }

    impl Default for FakeFacilitator {
        fn default() -> Self {
            Self {
                verify: StdMutex::new(VerifyResult {
                    is_valid: true,
                    invalid_reason: None,
                    invalid_message: None,
                    payer: Some(TEST_PAYER.to_string()),
                }),
                settle: StdMutex::new(SettleResult {
                    success: true,
                    error_reason: None,
                    error_message: None,
                    transaction: "0xtx".to_string(),
                    network: "eip155:84532".to_string(),
                    payer: Some(TEST_PAYER.to_string()),
                    amount: None,
                }),
                verify_calls: AtomicUsize::new(0),
            }
        }
    }

    impl FakeFacilitator {
        fn set_verify(&self, result: VerifyResult) {
            *self.verify.lock().unwrap() = result;
        }

        fn set_settle(&self, result: SettleResult) {
            *self.settle.lock().unwrap() = result;
        }

        fn verify_calls(&self) -> usize {
            self.verify_calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl Facilitator for FakeFacilitator {
        async fn verify(
            &self,
            _payload: &crate::x402::PaymentPayload,
            _reqs: &crate::x402::PaymentRequirements,
        ) -> Result<VerifyResult, FacilitatorError> {
            self.verify_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.verify.lock().unwrap().clone())
        }

        async fn settle(
            &self,
            _payload: &crate::x402::PaymentPayload,
            _reqs: &crate::x402::PaymentRequirements,
        ) -> Result<SettleResult, FacilitatorError> {
            Ok(self.settle.lock().unwrap().clone())
        }

        async fn supported(&self) -> Result<Vec<Kind>, FacilitatorError> {
            Ok(vec![])
        }
    }

    struct TestEnv {
        app: Router,
        store: Store,
        fac: Arc<FakeFacilitator>,
        _dir: TempDir,
    }

    async fn new_env(run_migrations: bool) -> TestEnv {
        new_env_with_transfer_method(run_migrations, "eip3009").await
    }

    async fn new_env_with_transfer_method(run_migrations: bool, transfer_method: &str) -> TestEnv {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.db");
        let database_url = format!("sqlite:{}", path.display());
        let store = Store::connect(&database_url).await.unwrap();
        if run_migrations {
            sqlx::migrate!("./migrations")
                .run(store.pool())
                .await
                .unwrap();
        }

        let config = Arc::new(Config {
            port: 4330,
            database_url,
            facilitator_url: "http://facilitator".to_string(),
            pay_to: TEST_PAY_TO.to_string(),
            network: "eip155:84532".to_string(),
            asset: TEST_ASSET.to_string(),
            asset_symbol: "USDC".to_string(),
            asset_decimals: 6,
            asset_name: "USDC".to_string(),
            asset_version: "2".to_string(),
            asset_transfer_method: transfer_method.to_string(),
            price_atomic: None,
            public_base_url: "http://example.test".to_string(),
            admin_token: TEST_ADMIN.to_string(),
            facilitator_timeout_secs: 1,
            log_level: "info".to_string(),
        });
        let fac = Arc::new(FakeFacilitator::default());
        let state = AppState {
            config,
            store: store.clone(),
            facilitator: fac.clone(),
            health: Arc::new(Mutex::new(HealthCache::default())),
        };

        TestEnv {
            app: router(state),
            store,
            fac,
            _dir: dir,
        }
    }

    async fn send(app: &Router, request: HttpRequest<Body>) -> (StatusCode, HeaderMap, Vec<u8>) {
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec();
        (status, headers, body)
    }

    fn payment_header(
        nonce: &str,
        value: i64,
        to: &str,
        from: &str,
        valid_before: DateTime<Utc>,
    ) -> String {
        let accepted = json!({
            "scheme": "exact",
            "network": "eip155:84532",
            "asset": TEST_ASSET,
            "amount": value.to_string(),
            "payTo": to,
            "maxTimeoutSeconds": 60,
            "extra": {"name": "USDC", "version": "2"}
        });
        let payload = json!({
            "x402Version": 2,
            "accepted": accepted,
            "payload": {
                "signature": "0xdead",
                "authorization": {
                    "from": from,
                    "to": to,
                    "value": value.to_string(),
                    "validAfter": "0",
                    "validBefore": valid_before.timestamp().to_string(),
                    "nonce": nonce
                }
            }
        });
        STANDARD.encode(serde_json::to_vec(&payload).unwrap())
    }

    fn valid_header(nonce: &str) -> String {
        payment_header(
            nonce,
            1000,
            TEST_PAY_TO,
            TEST_PAYER,
            Utc::now() + chrono::Duration::hours(1),
        )
    }

    fn permit2_header(nonce: &str) -> String {
        let accepted = json!({
            "scheme": "exact",
            "network": "eip155:84532",
            "asset": TEST_ASSET,
            "amount": "1000",
            "payTo": TEST_PAY_TO,
            "maxTimeoutSeconds": 60,
            "extra": {"assetTransferMethod": "permit2"}
        });
        let payload = json!({
            "x402Version": 2,
            "accepted": accepted,
            "payload": {
                "signature": "0xdead",
                "permit2Authorization": {
                    "from": TEST_PAYER,
                    "permitted": {"token": TEST_ASSET, "amount": "1000"},
                    "spender": "0x4444444444444444444444444444444444444444",
                    "nonce": nonce,
                    "deadline": (Utc::now() + chrono::Duration::hours(1)).timestamp().to_string(),
                    "witness": {"to": TEST_PAY_TO, "validAfter": "0"}
                }
            }
        });
        STANDARD.encode(serde_json::to_vec(&payload).unwrap())
    }

    fn echo_request(header: Option<&str>, body: &str) -> HttpRequest<Body> {
        let mut builder = HttpRequest::builder()
            .method("POST")
            .uri("/v1/echo")
            .header("content-type", "application/json");
        if let Some(header) = header {
            builder = builder.header("payment-signature", header);
        }
        builder.body(Body::from(body.to_string())).unwrap()
    }

    fn request_id(body: &[u8]) -> String {
        let value: Value = serde_json::from_slice(body).unwrap();
        value["data"]["request_id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn challenge_without_payment() {
        let env = new_env(true).await;
        let (status, headers, body) = send(&env.app, echo_request(None, "{}")).await;

        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
        assert!(headers.get("payment-required").is_some());
        assert_eq!(
            headers.get(CACHE_CONTROL).and_then(|v| v.to_str().ok()),
            Some("no-store")
        );
        let challenge: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(challenge["x402Version"], 2);
        assert_eq!(challenge["accepts"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn valid_payment_is_served_and_recorded() {
        let env = new_env(true).await;
        let (status, headers, body) = send(
            &env.app,
            echo_request(Some(&valid_header("0xn1")), r#"{"message":"hello"}"#),
        )
        .await;

        assert_eq!(
            status,
            StatusCode::OK,
            "body: {}",
            String::from_utf8_lossy(&body)
        );
        assert!(headers.get("payment-response").is_some());
        let id = request_id(&body);

        let attempt = env.store.get_attempt(&id).await.unwrap();
        assert_eq!(attempt.status, "served");
        assert_eq!(attempt.tx_hash.as_deref(), Some("0xtx"));
    }

    #[tokio::test]
    async fn permit2_payment_is_served() {
        let env = new_env_with_transfer_method(true, "permit2").await;
        let (status, headers, body) = send(
            &env.app,
            echo_request(Some(&permit2_header("0xp2")), r#"{"message":"usdt"}"#),
        )
        .await;

        assert_eq!(
            status,
            StatusCode::OK,
            "body: {}",
            String::from_utf8_lossy(&body)
        );
        assert!(headers.get("payment-response").is_some());

        let id = request_id(&body);
        let attempt = env.store.get_attempt(&id).await.unwrap();
        assert_eq!(attempt.status, "served");
        assert_eq!(attempt.asset, TEST_ASSET);
        assert_eq!(attempt.amount_atomic, 1000);
    }

    #[tokio::test]
    async fn invalid_payment_is_rejected() {
        let env = new_env(true).await;
        env.fac.set_verify(VerifyResult {
            is_valid: false,
            invalid_reason: Some("bad signature".to_string()),
            invalid_message: None,
            payer: None,
        });

        let (status, _, _) = send(&env.app, echo_request(Some(&valid_header("0xn2")), "{}")).await;
        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    }

    #[tokio::test]
    async fn expired_authorization_is_rejected_before_facilitator() {
        let env = new_env(true).await;
        let header = payment_header(
            "0xn3",
            1000,
            TEST_PAY_TO,
            TEST_PAYER,
            Utc::now() - chrono::Duration::hours(1),
        );
        let (status, _, _) = send(&env.app, echo_request(Some(&header), "{}")).await;
        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
        assert_eq!(env.fac.verify_calls(), 0);
    }

    #[tokio::test]
    async fn wrong_pay_to_is_rejected() {
        let env = new_env(true).await;
        let header = payment_header(
            "0xn4",
            1000,
            TEST_ASSET,
            TEST_PAYER,
            Utc::now() + chrono::Duration::hours(1),
        );
        let (status, _, _) = send(&env.app, echo_request(Some(&header), "{}")).await;
        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    }

    #[tokio::test]
    async fn wrong_amount_is_rejected() {
        let env = new_env(true).await;
        let header = payment_header(
            "0xn5",
            999,
            TEST_PAY_TO,
            TEST_PAYER,
            Utc::now() + chrono::Duration::hours(1),
        );
        let (status, _, _) = send(&env.app, echo_request(Some(&header), "{}")).await;
        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    }

    #[tokio::test]
    async fn payer_mismatch_is_rejected() {
        let env = new_env(true).await;
        env.fac.set_verify(VerifyResult {
            is_valid: true,
            invalid_reason: None,
            invalid_message: None,
            payer: Some(TEST_ASSET.to_string()),
        });
        let (status, _, _) = send(&env.app, echo_request(Some(&valid_header("0xn6")), "{}")).await;
        assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    }

    #[tokio::test]
    async fn replay_is_rejected_without_second_verify() {
        let env = new_env(true).await;
        let header = valid_header("0xn7");

        let (first, _, _) = send(&env.app, echo_request(Some(&header), "{}")).await;
        assert_eq!(first, StatusCode::OK);

        let (second, _, _) = send(&env.app, echo_request(Some(&header), "{}")).await;
        assert_eq!(second, StatusCode::CONFLICT);
        assert_eq!(env.fac.verify_calls(), 1);
    }

    #[tokio::test]
    async fn settle_failure_does_not_serve() {
        let env = new_env(true).await;
        env.fac.set_settle(SettleResult {
            success: false,
            error_reason: Some("no funds".to_string()),
            error_message: None,
            transaction: String::new(),
            network: String::new(),
            payer: None,
            amount: None,
        });

        let (status, _, _) = send(&env.app, echo_request(Some(&valid_header("0xn8")), "{}")).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);

        let status: String = sqlx::query_scalar("SELECT status FROM payment_attempts")
            .fetch_one(env.store.pool())
            .await
            .unwrap();
        assert_eq!(status, "settle_failed");
    }

    #[tokio::test]
    async fn body_limit_is_enforced() {
        let env = new_env(true).await;
        let body = "a".repeat((1 << 20) + 1);
        let (status, _, _) = send(&env.app, echo_request(None, &body)).await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn cors_preflight_is_free() {
        let env = new_env(true).await;
        let request = HttpRequest::builder()
            .method("OPTIONS")
            .uri("/v1/echo")
            .header("origin", "http://example.test")
            .header("access-control-request-method", "POST")
            .header("access-control-request-headers", "payment-signature")
            .body(Body::empty())
            .unwrap();
        let (status, headers, _) = send(&env.app, request).await;
        assert!(status == StatusCode::OK || status == StatusCode::NO_CONTENT);
        assert!(
            headers
                .get("access-control-allow-headers")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .contains("payment-signature")
        );
    }

    #[tokio::test]
    async fn admin_requires_token() {
        let env = new_env(true).await;
        let request = HttpRequest::builder()
            .method("GET")
            .uri("/admin/payments/missing")
            .body(Body::empty())
            .unwrap();
        let (status, _, _) = send(&env.app, request).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let request = HttpRequest::builder()
            .method("GET")
            .uri("/admin/payments/missing")
            .header("x-admin-token", TEST_ADMIN)
            .body(Body::empty())
            .unwrap();
        let (status, _, _) = send(&env.app, request).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn health_reports_ok_and_stale_schema() {
        let env = new_env(true).await;
        let request = HttpRequest::builder()
            .method("GET")
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let (status, _, _) = send(&env.app, request).await;
        assert_eq!(status, StatusCode::OK);

        let stale = new_env(false).await;
        let request = HttpRequest::builder()
            .method("GET")
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let (status, _, _) = send(&stale.app, request).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn models_are_free() {
        let env = new_env(true).await;
        let request = HttpRequest::builder()
            .method("GET")
            .uri("/v1/models")
            .body(Body::empty())
            .unwrap();
        let (status, _, body) = send(&env.app, request).await;
        assert_eq!(status, StatusCode::OK);
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["data"][0]["model"], "echo");
    }

    #[tokio::test]
    async fn end_to_end_challenge_paid_admin_replay() {
        let env = new_env(true).await;
        let body = r#"{"message":"hello"}"#;

        let (challenge, _, _) = send(&env.app, echo_request(None, body)).await;
        assert_eq!(challenge, StatusCode::PAYMENT_REQUIRED);

        let header = valid_header("0xe2e");
        let (paid, _, paid_body) = send(&env.app, echo_request(Some(&header), body)).await;
        assert_eq!(paid, StatusCode::OK);
        let id = request_id(&paid_body);

        let request = HttpRequest::builder()
            .method("GET")
            .uri(format!("/admin/payments/{id}"))
            .header("x-admin-token", TEST_ADMIN)
            .body(Body::empty())
            .unwrap();
        let (admin, _, admin_body) = send(&env.app, request).await;
        assert_eq!(admin, StatusCode::OK);
        let value: Value = serde_json::from_slice(&admin_body).unwrap();
        assert_eq!(value["data"]["status"], "served");

        let (replay, _, _) = send(&env.app, echo_request(Some(&header), body)).await;
        assert_eq!(replay, StatusCode::CONFLICT);
    }
}
