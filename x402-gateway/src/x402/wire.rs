use axum::http::HeaderMap;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const HEADER_REQUIRED: &str = "PAYMENT-REQUIRED";
pub const HEADER_SIGNATURE: &str = "PAYMENT-SIGNATURE";
pub const HEADER_RESPONSE: &str = "PAYMENT-RESPONSE";
pub const HEADER_LEGACY_PAYMENT: &str = "X-PAYMENT";
pub const HEADER_LEGACY_RESPONSE: &str = "X-PAYMENT-RESPONSE";
pub const SCHEME_EXACT: &str = "exact";
pub const TRANSFER_EIP3009: &str = "eip3009";
pub const TRANSFER_PERMIT2: &str = "permit2";

#[derive(Debug, Error)]
pub enum WireError {
    #[error("payment header is missing")]
    MissingHeader,
    #[error("payment header is not valid base64")]
    InvalidBase64,
    #[error("payment header is not valid JSON")]
    InvalidJson,
    #[error("unsupported x402 version {0}")]
    UnsupportedVersion(u8),
    #[error("payment header is missing scheme or network")]
    MissingSchemeOrNetwork,
    #[error("authorization not found in payment payload")]
    MissingAuthorization,
    #[error("authorization is invalid")]
    InvalidAuthorization,
    #[error("cannot encode payment data")]
    Encode,
}

/// x402 v2 payment requirements. The resource lives in PaymentRequired, not
/// here. `extra` carries either the EIP-712 domain (EIP-3009) or
/// `assetTransferMethod: "permit2"` for tokens such as USDT.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequirements {
    pub scheme: String,
    pub network: String,
    pub asset: String,
    pub amount: String,
    pub pay_to: String,
    pub max_timeout_seconds: u64,
    #[serde(default)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInfo {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequired {
    pub x402_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub resource: ResourceInfo,
    pub accepts: Vec<PaymentRequirements>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPayloadV2 {
    pub x402_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<ResourceInfo>,
    pub accepted: PaymentRequirements,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPayloadV1 {
    pub x402_version: u8,
    pub scheme: String,
    pub network: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum PaymentPayload {
    V2(PaymentPayloadV2),
    V1(PaymentPayloadV1),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub from: String,
    pub to: String,
    pub value: String,
    #[serde(default)]
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2Authorization {
    pub from: String,
    pub permitted: Permit2Permitted,
    pub spender: String,
    pub nonce: String,
    pub deadline: String,
    pub witness: Permit2Witness,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2Permitted {
    pub token: String,
    pub amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2Witness {
    pub to: String,
    #[serde(default)]
    pub valid_after: String,
}

/// Normalized authorization for both EIP-3009 and Permit2.
#[derive(Debug, Clone)]
pub struct PaymentAuthorization {
    pub from: String,
    pub to: String,
    pub amount: String,
    pub valid_before: i64,
    pub nonce: String,
    pub asset: Option<String>,
    pub transfer_method: &'static str,
}

impl PaymentPayload {
    pub fn x402_version(&self) -> u8 {
        match self {
            Self::V2(payload) => payload.x402_version,
            Self::V1(payload) => payload.x402_version,
        }
    }

    pub fn scheme(&self) -> &str {
        match self {
            Self::V2(payload) => &payload.accepted.scheme,
            Self::V1(payload) => &payload.scheme,
        }
    }

    pub fn network(&self) -> &str {
        match self {
            Self::V2(payload) => &payload.accepted.network,
            Self::V1(payload) => &payload.network,
        }
    }

    pub fn accepted(&self) -> Option<&PaymentRequirements> {
        match self {
            Self::V2(payload) => Some(&payload.accepted),
            Self::V1(_) => None,
        }
    }

    fn inner(&self) -> &Value {
        match self {
            Self::V2(payload) => &payload.payload,
            Self::V1(payload) => &payload.payload,
        }
    }

    /// Extracts EIP-3009 or Permit2 authorization into one shape.
    pub fn authorization(&self) -> Result<PaymentAuthorization, WireError> {
        let inner = self.inner();

        if let Some(value) = inner.get("authorization") {
            let auth: Authorization = serde_json::from_value(value.clone())
                .map_err(|_| WireError::MissingAuthorization)?;
            let valid_before = parse_unix_seconds(&auth.valid_before)
                .map_err(|_| WireError::InvalidAuthorization)?;
            return Ok(PaymentAuthorization {
                from: auth.from,
                to: auth.to,
                amount: auth.value,
                valid_before,
                nonce: auth.nonce,
                asset: None,
                transfer_method: TRANSFER_EIP3009,
            });
        }

        if let Some(value) = inner.get("permit2Authorization") {
            let auth: Permit2Authorization = serde_json::from_value(value.clone())
                .map_err(|_| WireError::MissingAuthorization)?;
            let valid_before =
                parse_unix_seconds(&auth.deadline).map_err(|_| WireError::InvalidAuthorization)?;
            return Ok(PaymentAuthorization {
                from: auth.from,
                to: auth.witness.to,
                amount: auth.permitted.amount,
                valid_before,
                nonce: auth.nonce,
                asset: Some(auth.permitted.token),
                transfer_method: TRANSFER_PERMIT2,
            });
        }

        Err(WireError::MissingAuthorization)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub is_valid: bool,
    #[serde(default)]
    pub invalid_reason: Option<String>,
    #[serde(default)]
    pub invalid_message: Option<String>,
    #[serde(default)]
    pub payer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleResult {
    pub success: bool,
    #[serde(default)]
    pub error_reason: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub payer: Option<String>,
    #[serde(default)]
    pub transaction: String,
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub amount: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kind {
    pub x402_version: u8,
    pub scheme: String,
    pub network: String,
}

/// Reads PAYMENT-SIGNATURE first, then X-PAYMENT.
pub fn decode_payment_header(headers: &HeaderMap) -> Result<(String, PaymentPayload), WireError> {
    let raw = headers
        .get("payment-signature")
        .or_else(|| headers.get("x-payment"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(WireError::MissingHeader)?;

    let decoded = decode_base64(raw).ok_or(WireError::InvalidBase64)?;
    let payload: PaymentPayload =
        serde_json::from_slice(&decoded).map_err(|_| WireError::InvalidJson)?;

    if payload.x402_version() != 1 && payload.x402_version() != 2 {
        return Err(WireError::UnsupportedVersion(payload.x402_version()));
    }
    if payload.scheme().is_empty() || payload.network().is_empty() {
        return Err(WireError::MissingSchemeOrNetwork);
    }

    Ok((raw.to_string(), payload))
}

pub fn encode_payment_required(body: &PaymentRequired) -> Result<String, WireError> {
    let body = serde_json::to_vec(body).map_err(|_| WireError::Encode)?;
    Ok(STANDARD.encode(body))
}

pub fn encode_settle_result(result: &SettleResult) -> Result<String, WireError> {
    let body = serde_json::to_vec(result).map_err(|_| WireError::Encode)?;
    Ok(STANDARD.encode(body))
}

pub fn parse_atomic(raw: &str) -> Result<i64, String> {
    if raw.is_empty() {
        return Err("amount is empty".to_string());
    }
    let value: i64 = raw
        .parse()
        .map_err(|_| "amount is not an integer".to_string())?;
    if value < 0 {
        return Err("amount must not be negative".to_string());
    }
    Ok(value)
}

pub fn parse_unix_seconds(raw: &str) -> Result<i64, String> {
    if raw.is_empty() {
        return Err("timestamp is empty".to_string());
    }
    let value: i64 = raw
        .parse()
        .map_err(|_| "timestamp is not an integer".to_string())?;
    if value < 0 {
        return Err("timestamp must not be negative".to_string());
    }
    Ok(value)
}

/// Validates the payload against the server requirements and returns the
/// normalized authorization. The facilitator still verifies the signature.
pub fn validate_payment(
    payload: &PaymentPayload,
    reqs: &PaymentRequirements,
    pay_to: &str,
    price_atomic: i64,
) -> Result<PaymentAuthorization, String> {
    if let Some(accepted) = payload.accepted() {
        if !accepted.scheme.eq_ignore_ascii_case(&reqs.scheme)
            || !accepted.network.eq_ignore_ascii_case(&reqs.network)
            || !accepted.asset.eq_ignore_ascii_case(&reqs.asset)
            || !accepted.pay_to.eq_ignore_ascii_case(&reqs.pay_to)
            || accepted.amount != reqs.amount
        {
            return Err("payment requirements mismatch".to_string());
        }
    } else if !payload.scheme().eq_ignore_ascii_case(&reqs.scheme)
        || !payload.network().eq_ignore_ascii_case(&reqs.network)
    {
        return Err("payment network mismatch".to_string());
    }

    let auth = payload.authorization().map_err(|err| err.to_string())?;
    let expected_method = reqs
        .extra
        .get("assetTransferMethod")
        .and_then(Value::as_str)
        .unwrap_or(TRANSFER_EIP3009);
    if auth.transfer_method != expected_method {
        return Err("payment transfer method mismatch".to_string());
    }
    if auth.from.is_empty() || auth.nonce.is_empty() {
        return Err("payment authorization is incomplete".to_string());
    }
    if !auth.to.eq_ignore_ascii_case(pay_to) {
        return Err("payment recipient mismatch".to_string());
    }
    let amount = parse_atomic(&auth.amount)?;
    if amount < price_atomic {
        return Err("payment amount is too low".to_string());
    }
    if let Some(asset) = &auth.asset {
        if !asset.eq_ignore_ascii_case(&reqs.asset) {
            return Err("payment asset mismatch".to_string());
        }
    }
    if auth.valid_before <= chrono::Utc::now().timestamp() + 30 {
        return Err("payment authorization is expired".to_string());
    }
    Ok(auth)
}

pub fn payload_hash(raw: &str) -> String {
    let digest = Sha256::digest(raw.as_bytes());
    hex::encode(digest)
}

fn decode_base64(raw: &str) -> Option<Vec<u8>> {
    let engines = [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD];
    for engine in engines {
        if let Ok(bytes) = engine.decode(raw) {
            return Some(bytes);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn requirements() -> PaymentRequirements {
        PaymentRequirements {
            scheme: SCHEME_EXACT.to_string(),
            network: "eip155:84532".to_string(),
            asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e".to_string(),
            amount: "1000".to_string(),
            pay_to: "0x1111111111111111111111111111111111111111".to_string(),
            max_timeout_seconds: 60,
            extra: Map::new(),
        }
    }

    fn v2_payload(nonce: &str, transfer_method: &str) -> PaymentPayload {
        let inner = if transfer_method == TRANSFER_PERMIT2 {
            serde_json::json!({
                "signature": "0xdead",
                "permit2Authorization": {
                    "from": "0x3333333333333333333333333333333333333333",
                    "permitted": {
                        "token": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
                        "amount": "1000"
                    },
                    "spender": "0x4444444444444444444444444444444444444444",
                    "nonce": nonce,
                    "deadline": "9999999999",
                    "witness": {
                        "to": "0x1111111111111111111111111111111111111111",
                        "validAfter": "0"
                    }
                }
            })
        } else {
            serde_json::json!({
                "signature": "0xdead",
                "authorization": {
                    "from": "0x3333333333333333333333333333333333333333",
                    "to": "0x1111111111111111111111111111111111111111",
                    "value": "1000",
                    "validAfter": "0",
                    "validBefore": "9999999999",
                    "nonce": nonce
                }
            })
        };
        let mut accepted = requirements();
        if transfer_method == TRANSFER_PERMIT2 {
            accepted.extra.insert(
                "assetTransferMethod".to_string(),
                Value::String(TRANSFER_PERMIT2.to_string()),
            );
        }
        PaymentPayload::V2(PaymentPayloadV2 {
            x402_version: 2,
            resource: None,
            accepted,
            payload: inner,
            extensions: None,
        })
    }

    #[test]
    fn challenge_round_trip() {
        let body = PaymentRequired {
            x402_version: 2,
            error: Some("payment required".to_string()),
            resource: ResourceInfo {
                url: "http://example.test/v1/echo".to_string(),
                description: Some("echo".to_string()),
                mime_type: Some("application/json".to_string()),
            },
            accepts: vec![requirements()],
            extensions: None,
        };
        let encoded = encode_payment_required(&body).unwrap();
        let decoded = STANDARD.decode(encoded).unwrap();
        let parsed: PaymentRequired = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(parsed.accepts[0].amount, "1000");
        assert_eq!(parsed.resource.url, "http://example.test/v1/echo");
    }

    #[test]
    fn header_precedence_prefers_v2() {
        let v2 = v2_payload("0xv2", TRANSFER_EIP3009);
        let v1 = PaymentPayload::V1(PaymentPayloadV1 {
            x402_version: 1,
            scheme: SCHEME_EXACT.to_string(),
            network: "base-sepolia".to_string(),
            payload: serde_json::json!({
                "authorization": {
                    "from": "0x3333333333333333333333333333333333333333",
                    "to": "0x1111111111111111111111111111111111111111",
                    "value": "1000",
                    "validBefore": "9999999999",
                    "nonce": "0xv1"
                }
            }),
        });

        let mut headers = HeaderMap::new();
        headers.insert(
            "payment-signature",
            HeaderValue::from_str(&STANDARD.encode(serde_json::to_vec(&v2).unwrap())).unwrap(),
        );
        headers.insert(
            "x-payment",
            HeaderValue::from_str(&STANDARD.encode(serde_json::to_vec(&v1).unwrap())).unwrap(),
        );

        let (_, payload) = decode_payment_header(&headers).unwrap();
        assert_eq!(payload.authorization().unwrap().nonce, "0xv2");
    }

    #[test]
    fn malformed_header_is_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert("payment-signature", HeaderValue::from_static("not-base64"));
        assert!(decode_payment_header(&headers).is_err());
    }

    #[test]
    fn eip3009_and_permit2_authorizations_are_normalized() {
        let eip = v2_payload("0xeip", TRANSFER_EIP3009)
            .authorization()
            .unwrap();
        assert_eq!(eip.transfer_method, TRANSFER_EIP3009);
        assert_eq!(eip.amount, "1000");
        assert_eq!(eip.valid_before, 9999999999);

        let permit2 = v2_payload("0xpermit", TRANSFER_PERMIT2)
            .authorization()
            .unwrap();
        assert_eq!(permit2.transfer_method, TRANSFER_PERMIT2);
        assert_eq!(permit2.amount, "1000");
        assert_eq!(
            permit2.asset.as_deref(),
            Some("0x036cbd53842c5426634e7929541ec2318f3dcf7e")
        );
    }

    #[test]
    fn validate_payment_rejects_accepted_mismatch() {
        let payload = v2_payload("0x1", TRANSFER_EIP3009);
        let mut reqs = requirements();
        reqs.amount = "2000".to_string();
        assert!(validate_payment(&payload, &reqs, &reqs.pay_to, 2000).is_err());
    }

    #[test]
    fn validate_payment_accepts_permit2() {
        let payload = v2_payload("0x2", TRANSFER_PERMIT2);
        let mut reqs = requirements();
        reqs.extra.insert(
            "assetTransferMethod".to_string(),
            Value::String(TRANSFER_PERMIT2.to_string()),
        );
        let auth = validate_payment(&payload, &reqs, &reqs.pay_to, 1000).unwrap();
        assert_eq!(auth.transfer_method, TRANSFER_PERMIT2);
    }

    #[test]
    fn validate_payment_rejects_transfer_method_mismatch() {
        let payload = v2_payload("0x3", TRANSFER_EIP3009);
        let mut reqs = requirements();
        reqs.extra.insert(
            "assetTransferMethod".to_string(),
            Value::String(TRANSFER_PERMIT2.to_string()),
        );
        assert!(validate_payment(&payload, &reqs, &reqs.pay_to, 1000).is_err());
    }
}
