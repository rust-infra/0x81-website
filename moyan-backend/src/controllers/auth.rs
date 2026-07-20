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
    let token_response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", params.code.as_str()),
            ("client_id", state.google_client_id.as_str()),
            ("client_secret", state.google_client_secret.as_str()),
            ("redirect_uri", state.google_redirect_url.as_str()),
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
