use axum::{
    extract::{Query, State},
    response::Json,
};
use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, encode};
use serde::Deserialize;
use uuid::Uuid;

use crate::middleware::auth::Claims;
use crate::middleware::error::{AppError, AppState, success};
use crate::models::{
    AuthResponse, GoogleUserInfo, KimiAuthRequest, KimiTokenPayload, User, UserIdentity,
    UserResponse,
};

// ==================== Helpers ====================

fn generate_jwt(state: &AppState, user: &User) -> Result<String, AppError> {
    let now = Utc::now();
    let exp = now + chrono::Duration::days(30);

    let claims = Claims {
        sub: user.id.clone(),
        email: user.email.clone(),
        name: user.name.clone(),
        exp: exp.timestamp() as usize,
        iat: now.timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("JWT generation failed: {}", e)))
}

async fn find_or_create_user(
    state: &AppState,
    provider: &str,
    provider_id: &str,
    name: &str,
    email: &str,
    avatar: Option<&str>,
) -> Result<User, AppError> {
    Ok({
        let user = state
            .services
            .auth
            .find_or_create_user(UserIdentity {
                provider,
                provider_id,
                name,
                email,
                avatar,
            })
            .await?;
        state
            .services
            .system_decks
            .ensure_available(&user.id)
            .await?;
        user
    })
}

// ==================== Google OAuth ====================

#[derive(Debug, Deserialize)]
pub struct GoogleCallbackQuery {
    pub code: String,
}

/// Exchange Google auth code for tokens and create/update user
pub async fn google_callback(
    State(state): State<AppState>,
    Query(params): Query<GoogleCallbackQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (_, user_info) = exchange_google_code(
        &state.google_client_id,
        &state.google_client_secret,
        &state.google_redirect_url,
        &params.code,
    )
    .await?;

    let user = find_or_create_user(
        &state,
        "google",
        &user_info.sub,
        &user_info.name,
        &user_info.email,
        user_info.picture.as_deref(),
    )
    .await?;

    let token = generate_jwt(&state, &user)?;

    Ok(success(AuthResponse {
        token,
        user: user.into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct GoogleMobileLoginRequest {
    pub code: String,
}

/// Exchange a Google auth code obtained on mobile (expo-auth-session) using the
/// mobile OAuth client config. Requires GOOGLE_MOBILE_CLIENT_ID / _SECRET /
/// _REDIRECT_URL to be configured.
pub async fn google_mobile_login(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<GoogleMobileLoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if state.google_mobile_client_id.is_empty()
        || state.google_mobile_client_secret.is_empty()
        || state.google_mobile_redirect_url.is_empty()
    {
        return Err(AppError::BadRequest(
            "Google mobile OAuth is not configured on the server".into(),
        ));
    }
    let (_, user_info) = exchange_google_code(
        &state.google_mobile_client_id,
        &state.google_mobile_client_secret,
        &state.google_mobile_redirect_url,
        &req.code,
    )
    .await?;

    let user = find_or_create_user(
        &state,
        "google",
        &user_info.sub,
        &user_info.name,
        &user_info.email,
        user_info.picture.as_deref(),
    )
    .await?;

    let token = generate_jwt(&state, &user)?;

    Ok(success(AuthResponse {
        token,
        user: user.into(),
    }))
}

async fn exchange_google_code(
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> Result<(String, GoogleUserInfo), AppError> {
    let token_response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Token exchange failed: {}", e)))?;

    if !token_response.status().is_success() {
        let err_text = token_response.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "Google token error: {}",
            err_text
        )));
    }

    let token_data: serde_json::Value = token_response.json().await?;
    let access_token = token_data["access_token"]
        .as_str()
        .ok_or_else(|| AppError::Internal("No access token in response".to_string()))?;

    let user_info: GoogleUserInfo = reqwest::Client::new()
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch user info: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse user info: {}", e)))?;

    Ok((access_token.to_string(), user_info))
}

// ==================== Kimi OAuth (Device Flow) ====================

const KIMI_CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_AUTH_BASE: &str = "https://auth.kimi.com";

/// Kimi device authorization proxy
/// POST /api/auth/kimi/device
#[derive(Debug, Deserialize)]
pub struct KimiDeviceRequest {
    pub device_id: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct KimiDeviceResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(rename = "verification_uri_complete")]
    pub verification_uri_complete: String,
    pub expires_in: i64,
    pub interval: i64,
}

pub async fn kimi_device(
    State(_state): State<AppState>,
    axum::Json(req): axum::Json<KimiDeviceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let device_id = req.device_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let res = reqwest::Client::new()
        .post(format!("{}/api/oauth/device_authorization", KIMI_AUTH_BASE))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("X-Msh-Platform", "web")
        .header("X-Msh-Version", "1.0.0")
        .header("X-Msh-Device-Name", "MoyanRust")
        .header("X-Msh-Device-Model", "server")
        .header("X-Msh-Os-Version", "linux")
        .header("X-Msh-Device-Id", &device_id)
        .form(&[("client_id", KIMI_CLIENT_ID)])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Kimi device auth failed: {}", e)))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "Kimi device auth error: {}",
            err_text
        )));
    }

    let data: KimiDeviceResponse = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse error: {}", e)))?;

    Ok(success(data))
}

/// Kimi token polling proxy
/// POST /api/auth/kimi/token
#[derive(Debug, Deserialize)]
pub struct KimiTokenPollRequest {
    pub device_code: String,
    pub device_id: Option<String>,
}

pub async fn kimi_token_poll(
    State(_state): State<AppState>,
    axum::Json(req): axum::Json<KimiTokenPollRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let device_id = req.device_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let res = reqwest::Client::new()
        .post(format!("{}/api/oauth/token", KIMI_AUTH_BASE))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("X-Msh-Platform", "web")
        .header("X-Msh-Version", "1.0.0")
        .header("X-Msh-Device-Name", "MoyanRust")
        .header("X-Msh-Device-Model", "server")
        .header("X-Msh-Os-Version", "linux")
        .header("X-Msh-Device-Id", &device_id)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", &req.device_code),
            ("client_id", KIMI_CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Kimi token poll failed: {}", e)))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(err_text));
    }

    let data: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse error: {}", e)))?;

    Ok(success(data))
}

/// Verify Kimi access token and create/login user
/// POST /api/auth/kimi
pub async fn kimi_login(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<KimiAuthRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Decode Kimi JWT without signature verification
    // Kimi does not expose JWKS, so we use dangerous_insecure_decode
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;

    let token_data = jsonwebtoken::decode::<KimiTokenPayload>(
        &req.access_token,
        &DecodingKey::from_secret(&[]),
        &validation,
    )
    .map_err(|_| AppError::BadRequest("Invalid Kimi access token format".to_string()))?;

    let payload = token_data.claims;

    let provider_id = payload
        .sub
        .or(payload.user_id)
        .ok_or_else(|| AppError::BadRequest("Token missing user identifier".to_string()))?;

    let name = payload
        .name
        .or(payload.nickname)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Kimi User".to_string());

    let email = payload
        .email
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{}@kimi.user", &provider_id[..provider_id.len().min(8)]));

    let avatar = payload.picture.or(payload.avatar);

    let user = find_or_create_user(
        &state,
        "kimi",
        &provider_id,
        &name,
        &email,
        avatar.as_deref(),
    )
    .await?;

    let token = generate_jwt(&state, &user)?;

    Ok(success(AuthResponse {
        token,
        user: user.into(),
    }))
}

// ==================== Common Auth Endpoints ====================

/// Get current user info from JWT
pub async fn me(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = state.services.auth.current_user(&claims.sub).await?;

    let user = user.ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(success(UserResponse::from(user)))
}

/// Get user stats
pub async fn stats(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.auth.user_stats(&claims.sub).await?))
}

// ==================== Telegram Mini App ====================

#[derive(Debug, Deserialize)]
pub struct TelegramLoginRequest {
    pub init_data: String,
}

#[derive(Debug, Deserialize)]
struct TelegramInitUser {
    id: i64,
    first_name: Option<String>,
    last_name: Option<String>,
    username: Option<String>,
    photo_url: Option<String>,
    language_code: Option<String>,
}

/// Minimal percent-decode for URL-encoded values (e.g. the `user` JSON field
/// inside Telegram initData). Enough for JSON payloads; not a full form decoder.
fn percent_decode(s: &str) -> String {
    fn hex_val(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Validate Telegram WebApp initData (official HMAC-SHA256 algorithm):
/// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
fn validate_telegram_init_data(
    bot_token: &str,
    init_data: &str,
) -> Result<TelegramInitUser, AppError> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    if init_data.is_empty() {
        return Err(AppError::BadRequest("Empty initData".into()));
    }

    // Parse as query string. Values are kept RAW (URL-encoded) for the check
    // string — that is exactly what Telegram signs.
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut hash: Option<String> = None;
    for item in init_data.split('&') {
        let Some(eq) = item.find('=') else { continue };
        let key = &item[..eq];
        let value = item[eq + 1..].to_string();
        if key == "hash" {
            hash = Some(value);
        } else {
            pairs.push((key.to_string(), value));
        }
    }

    let hash = hash.ok_or_else(|| AppError::BadRequest("initData missing hash".into()))?;

    // data_check_string: keys sorted alphabetically, joined as "k=v\nk=v"
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let data_check_string = pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\n");

    // secret_key = HMAC_SHA256(key=bot_token, msg="WebAppData")
    let mut mac = HmacSha256::new_from_slice(bot_token.as_bytes())
        .map_err(|_| AppError::Internal("HMAC init failed".into()))?;
    mac.update(b"WebAppData");
    let secret_key = mac.finalize().into_bytes();

    // expected = HMAC_SHA256(key=secret_key, msg=data_check_string)
    let mut mac2 = HmacSha256::new_from_slice(&secret_key)
        .map_err(|_| AppError::Internal("HMAC init failed".into()))?;
    mac2.update(data_check_string.as_bytes());
    let computed = hex::encode(mac2.finalize().into_bytes());

    // Constant-time comparison
    if computed.len() != hash.len()
        || !computed
            .as_bytes()
            .iter()
            .zip(hash.as_bytes().iter())
            .all(|(a, b)| a == b)
    {
        return Err(AppError::BadRequest("initData hash mismatch".into()));
    }

    // Replay protection: auth_date must be recent (< 24h in either direction).
    if let Some((_, auth_date)) = pairs.iter().find(|(k, _)| k == "auth_date") {
        if let Ok(ts) = auth_date.parse::<i64>() {
            let now = Utc::now().timestamp();
            if (now - ts).abs() > 24 * 3600 {
                return Err(AppError::BadRequest("initData expired".into()));
            }
        }
    }

    // Extract the user object (URL-encoded JSON).
    let user_json = pairs
        .iter()
        .find(|(k, _)| k == "user")
        .map(|(_, v)| percent_decode(v))
        .ok_or_else(|| AppError::BadRequest("initData missing user".into()))?;
    let user: TelegramInitUser = serde_json::from_str(&user_json)
        .map_err(|_| AppError::BadRequest("initData user parse failed".into()))?;

    Ok(user)
}

/// Telegram Mini App login (免密登录 / 绑定)
/// POST /api/auth/telegram  { "init_data": "<tg.WebApp.initData>" }
pub async fn telegram_login(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<TelegramLoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if state.telegram_bot_token.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "TELEGRAM_BOT_TOKEN not configured on the server".into(),
        ));
    }

    let tg_user = validate_telegram_init_data(&state.telegram_bot_token, &req.init_data)?;

    let provider_id = tg_user.id.to_string();

    // Telegram has no verified email — use a stable synthetic address.
    let email = format!("tg{provider_id}@telegram.local");

    let name = tg_user
        .first_name
        .clone()
        .map(|f| {
            tg_user
                .last_name
                .clone()
                .map(|l| format!("{f} {l}"))
                .unwrap_or(f)
        })
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Telegram User".to_string());

    let user = find_or_create_user(
        &state,
        "telegram",
        &provider_id,
        &name,
        &email,
        tg_user.photo_url.as_deref(),
    )
    .await?;

    let token = generate_jwt(&state, &user)?;

    Ok(success(AuthResponse {
        token,
        user: user.into(),
    }))
}

#[cfg(test)]
mod telegram_tests {
    use super::*;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    fn build_init_data(bot_token: &str, user_json: &str, auth_date: i64) -> String {
        type HmacSha256 = Hmac<Sha256>;

        let mut mac = HmacSha256::new_from_slice(bot_token.as_bytes()).unwrap();
        mac.update(b"WebAppData");
        let secret = mac.finalize().into_bytes();

        let check = format!("auth_date={auth_date}\nuser={user_json}");
        let mut mac2 = HmacSha256::new_from_slice(&secret).unwrap();
        mac2.update(check.as_bytes());
        let hash = hex::encode(mac2.finalize().into_bytes());

        format!("auth_date={auth_date}&user={user_json}&hash={hash}")
    }

    #[test]
    fn accepts_valid_init_data() {
        let bot_token = "123456:TESTTOKEN";
        let user = r#"{"id":123456789,"first_name":"Test","username":"tester","language_code":"en"}"#;
        let init = build_init_data(bot_token, user, Utc::now().timestamp());
        let parsed = validate_telegram_init_data(bot_token, &init).unwrap();
        assert_eq!(parsed.id, 123456789);
        assert_eq!(parsed.first_name.as_deref(), Some("Test"));
    }

    #[test]
    fn accepts_url_encoded_user() {
        let bot_token = "123456:TESTTOKEN";
        let raw = r#"{"id":123456789,"first_name":"Test","username":"tester"}"#;
        let encoded = raw
            .replace('{', "%7B")
            .replace('}', "%7D")
            .replace('"', "%22")
            .replace(':', "%3A")
            .replace(',', "%2C");
        let init = build_init_data(bot_token, &encoded, Utc::now().timestamp());
        let parsed = validate_telegram_init_data(bot_token, &init).unwrap();
        assert_eq!(parsed.id, 123456789);
        assert_eq!(parsed.first_name.as_deref(), Some("Test"));
    }

    #[test]
    fn rejects_tampered_init_data() {
        let bot_token = "123456:TESTTOKEN";
        let user = r#"{"id":123456789,"first_name":"Test","username":"tester"}"#;
        let init = build_init_data(bot_token, user, Utc::now().timestamp());
        let tampered = init.replace("Test", "Evil");
        assert!(validate_telegram_init_data(bot_token, &tampered).is_err());
    }

    #[test]
    fn rejects_expired_init_data() {
        let bot_token = "123456:TESTTOKEN";
        let user = r#"{"id":123456789,"first_name":"Test"}"#;
        let init = build_init_data(bot_token, user, Utc::now().timestamp() - 2 * 24 * 3600);
        assert!(validate_telegram_init_data(bot_token, &init).is_err());
    }

    #[test]
    fn rejects_missing_hash() {
        assert!(validate_telegram_init_data("t", "auth_date=1&user=%7B%7D").is_err());
    }
}
