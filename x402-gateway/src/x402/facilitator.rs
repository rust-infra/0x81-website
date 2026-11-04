use crate::x402::wire::{Kind, PaymentPayload, PaymentRequirements, SettleResult, VerifyResult};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FacilitatorError {
    #[error("facilitator unavailable: {0}")]
    Unavailable(String),
    #[error("facilitator protocol error: {0}")]
    Protocol(String),
    #[error("facilitator returned status {status}: {body}")]
    Http { status: u16, body: String },
}

#[async_trait]
pub trait Facilitator: Send + Sync {
    async fn verify(
        &self,
        payload: &PaymentPayload,
        reqs: &PaymentRequirements,
    ) -> Result<VerifyResult, FacilitatorError>;

    async fn settle(
        &self,
        payload: &PaymentPayload,
        reqs: &PaymentRequirements,
    ) -> Result<SettleResult, FacilitatorError>;

    async fn supported(&self) -> Result<Vec<Kind>, FacilitatorError>;
}

#[derive(Clone)]
pub struct HttpFacilitator {
    base_url: String,
    client: Client,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaymentRequest<'a> {
    x402_version: u8,
    payment_payload: &'a PaymentPayload,
    payment_requirements: &'a PaymentRequirements,
}

#[derive(Deserialize)]
struct SupportedResponse {
    kinds: Vec<Kind>,
}

impl HttpFacilitator {
    pub fn new(base_url: &str, timeout_secs: u64) -> Result<Self, FacilitatorError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|err| FacilitatorError::Protocol(err.to_string()))?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client,
        })
    }

    async fn post<T, R>(&self, path: &str, body: &T) -> Result<R, FacilitatorError>
    where
        T: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        let response = self
            .client
            .post(format!("{}{path}", self.base_url))
            .json(body)
            .send()
            .await
            .map_err(|err| FacilitatorError::Unavailable(err.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| FacilitatorError::Unavailable(err.to_string()))?;

        if !status.is_success() {
            return Err(FacilitatorError::Http {
                status: status.as_u16(),
                body: text.chars().take(512).collect(),
            });
        }

        serde_json::from_str(&text).map_err(|err| FacilitatorError::Protocol(err.to_string()))
    }
}

#[async_trait]
impl Facilitator for HttpFacilitator {
    async fn verify(
        &self,
        payload: &PaymentPayload,
        reqs: &PaymentRequirements,
    ) -> Result<VerifyResult, FacilitatorError> {
        self.post(
            "/verify",
            &PaymentRequest {
                x402_version: payload.x402_version(),
                payment_payload: payload,
                payment_requirements: reqs,
            },
        )
        .await
    }

    async fn settle(
        &self,
        payload: &PaymentPayload,
        reqs: &PaymentRequirements,
    ) -> Result<SettleResult, FacilitatorError> {
        let mut last_error = None;
        for attempt in 0..3 {
            let result = self
                .post(
                    "/settle",
                    &PaymentRequest {
                        x402_version: payload.x402_version(),
                        payment_payload: payload,
                        payment_requirements: reqs,
                    },
                )
                .await;

            match result {
                Ok(result) => return Ok(result),
                Err(error) => {
                    let retry = match &error {
                        FacilitatorError::Http { status, .. } => *status >= 500 || *status == 429,
                        FacilitatorError::Unavailable(_) => true,
                        FacilitatorError::Protocol(_) => false,
                    };
                    last_error = Some(error);
                    if !retry || attempt == 2 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(250 * (attempt as u64 + 1))).await;
                }
            }
        }
        Err(last_error.unwrap_or_else(|| FacilitatorError::Protocol("settle failed".to_string())))
    }

    async fn supported(&self) -> Result<Vec<Kind>, FacilitatorError> {
        let response = self
            .client
            .get(format!("{}/supported", self.base_url))
            .send()
            .await
            .map_err(|err| FacilitatorError::Unavailable(err.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| FacilitatorError::Unavailable(err.to_string()))?;

        if !status.is_success() {
            return Err(FacilitatorError::Http {
                status: status.as_u16(),
                body: text.chars().take(512).collect(),
            });
        }

        let parsed: SupportedResponse = serde_json::from_str(&text)
            .map_err(|err| FacilitatorError::Protocol(err.to_string()))?;
        Ok(parsed.kinds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::x402::PaymentPayloadV2;
    use axum::extract::State;
    use axum::response::IntoResponse;
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    async fn spawn(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn payload() -> PaymentPayload {
        PaymentPayload::V2(PaymentPayloadV2 {
            x402_version: 2,
            resource: None,
            accepted: requirements(),
            payload: serde_json::json!({
                "signature": "0xdead",
                "authorization": {
                    "from": "0xpayer",
                    "to": "0xpayto",
                    "value": "1000",
                    "validBefore": "9999999999",
                    "nonce": "0x1"
                }
            }),
            extensions: None,
        })
    }

    fn requirements() -> PaymentRequirements {
        PaymentRequirements {
            scheme: "exact".to_string(),
            network: "eip155:84532".to_string(),
            asset: "0xasset".to_string(),
            amount: "1000".to_string(),
            pay_to: "0xpayto".to_string(),
            max_timeout_seconds: 60,
            extra: serde_json::Map::new(),
        }
    }

    #[tokio::test]
    async fn verify_and_settle_round_trip() {
        let app = Router::new()
            .route(
                "/verify",
                post(|| async {
                    Json(VerifyResult {
                        is_valid: true,
                        invalid_reason: None,
                        invalid_message: None,
                        payer: Some("0xpayer".to_string()),
                    })
                }),
            )
            .route(
                "/settle",
                post(|| async {
                    Json(SettleResult {
                        success: true,
                        error_reason: None,
                        error_message: None,
                        transaction: "0xtx".to_string(),
                        network: "eip155:84532".to_string(),
                        payer: Some("0xpayer".to_string()),
                        amount: None,
                    })
                }),
            )
            .route(
                "/supported",
                get(|| async {
                    Json(serde_json::json!({
                        "kinds": [{"x402Version": 2, "scheme": "exact", "network": "eip155:84532"}]
                    }))
                }),
            );

        let url = spawn(app).await;
        let client = HttpFacilitator::new(&url, 2).unwrap();

        let verify = client.verify(&payload(), &requirements()).await.unwrap();
        assert!(verify.is_valid);
        assert_eq!(verify.payer.as_deref(), Some("0xpayer"));

        let settle = client.settle(&payload(), &requirements()).await.unwrap();
        assert!(settle.success);
        assert_eq!(settle.transaction, "0xtx");

        let kinds = client.supported().await.unwrap();
        assert_eq!(kinds.len(), 1);
    }

    #[tokio::test]
    async fn settle_retries_server_errors() {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/settle",
                post(|State(calls): State<Arc<AtomicUsize>>| async move {
                    let attempt = calls.fetch_add(1, Ordering::SeqCst);
                    if attempt == 0 {
                        (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": "temporary"})),
                        )
                            .into_response()
                    } else {
                        Json(SettleResult {
                            success: true,
                            error_reason: None,
                            error_message: None,
                            transaction: "0xtx".to_string(),
                            network: "eip155:84532".to_string(),
                            payer: Some("0xpayer".to_string()),
                            amount: None,
                        })
                        .into_response()
                    }
                }),
            )
            .with_state(calls.clone());

        let url = spawn(app).await;
        let client = HttpFacilitator::new(&url, 2).unwrap();
        let settle = client.settle(&payload(), &requirements()).await.unwrap();
        assert!(settle.success);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn settle_does_not_retry_client_errors() {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/settle",
                post(|State(calls): State<Arc<AtomicUsize>>| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    (
                        axum::http::StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "bad"})),
                    )
                        .into_response()
                }),
            )
            .with_state(calls.clone());

        let url = spawn(app).await;
        let client = HttpFacilitator::new(&url, 2).unwrap();
        assert!(client.settle(&payload(), &requirements()).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
