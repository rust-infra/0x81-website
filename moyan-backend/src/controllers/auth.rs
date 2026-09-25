use axum::{
    extract::{Query, State},
    response::Json,
};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::Deserialize;
use uuid::Uuid;

use crate::middleware::auth::Claims;
use crate::middleware::error::{AppError, AppState, success};
use crate::models::{
    AuthResponse, GoogleUserInfo, KimiTokenPayload, User, UserIdentity,
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

/// Kimi 的 OAuth 基址。`MOYAN_KIMI_BASE_URL` **只为测试**存在（指向本地 stub），
/// 生产一律是 `KIMI_AUTH_BASE`。
fn kimi_base() -> String {
    std::env::var("MOYAN_KIMI_BASE_URL").unwrap_or_else(|_| KIMI_AUTH_BASE.to_string())
}

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
        .post(format!("{}/api/oauth/device_authorization", kimi_base()))
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

/// Kimi device flow 的轮询端点。
///
/// 授权完成时**由服务端**拿 access_token 去 Kimi 的 userinfo 校验并建号，只把
/// 「我们自己的 JWT」返回给客户端 —— Kimi 的 access_token 不出这个函数。
/// （2026-09-18 之前是客户端把 access_token 提交到 `/api/auth/kimi`，而那边不验签。）
pub async fn kimi_token_poll(
    State(state): State<AppState>,
    axum::Json(req): axum::Json<KimiTokenPollRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let device_id = req.device_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let res = reqwest::Client::new()
        .post(format!("{}/api/oauth/token", kimi_base()))
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

    // 用户还没授权（authorization_pending / slow_down）或出错：原样透传，
    // 客户端据此继续轮询或报错。
    let Some(access_token) = data
        .get("access_token")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return Ok(success(data));
    };

    let refresh_token = data
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    // 授权完成：立刻用 Kimi 自己的 userinfo 复核这个 token 并建号。失败（含伪造 /
    // 过期 token）一律 401 —— **绝不降级**成"本地解 JWT 取 sub"。
    //
    // 例外：Kimi 的 userinfo 目前会拒收它**自己刚签发**的 ES256 token（2026-09-18
    // 实测，见 `kimi_user_from_refresh_verification` 的说明）。这种情况改用 Kimi 的
    // token 端点做等价的复核；除此之外仍然一律 401。
    let user = match kimi_user_from_access_token(&state, &access_token).await {
        Ok(user) => user,
        Err(AppError::Unauthorized(message)) => match refresh_token.as_deref() {
            Some(refresh_token) => {
                kimi_user_from_refresh_verification(&state, refresh_token, &access_token).await?
            }
            None => return Err(AppError::Unauthorized(message)),
        },
        Err(err) => return Err(err),
    };
    let token = generate_jwt(&state, &user)?;

    Ok(success(serde_json::json!({
        "token": token,
        "user": UserResponse::from(user),
    })))
}

/// Kimi 未返回 email 时的占位邮箱：取 provider_id 的前 8 个**字符**。
///
/// 必须按字符切：`&s[..8]` 是字节切片，provider_id（来自 token 的 `sub`）若含多字节
/// UTF-8 且第 8 字节落在非字符边界上会直接 panic（2026-09-18 修正）。
/// 纯展示用——身份判定仍是 `users` 的 `UNIQUE(provider, provider_id)` 全值。
fn kimi_placeholder_email(provider_id: &str) -> String {
    let head: String = provider_id.chars().take(8).collect();
    format!("{head}@kimi.user")
}

/// 用 Kimi 的 userinfo 端点复核 access_token，并据此建号 / 登录。
///
/// 这是**首选**的身份信任来源：token 由 Kimi 签发、由 Kimi 校验，我们只读它返回的
/// `sub`（顺带拿 name/email/avatar）。Kimi 不在 JWKS 暴露公钥，所以"本地验签"做不到——
/// 同理，"本地解 JWT 取 sub"等于信任调用方，绝不能用（见 `kimi_login_deprecated` 的说明）。
///
/// 上游异常时的兜底见 `kimi_user_from_refresh_verification`（同样由 Kimi 复核，不降级成本地验签）。
async fn kimi_user_from_access_token(
    state: &AppState,
    access_token: &str,
) -> Result<User, AppError> {
    let res = reqwest::Client::new()
        .get(format!("{}/api/oauth/userinfo", kimi_base()))
        .header("Accept", "application/json")
        .header("X-Msh-Platform", "web")
        .header("X-Msh-Version", "1.0.0")
        .header("X-Msh-Device-Name", "MoyanRust")
        .header("X-Msh-Device-Model", "server")
        .header("X-Msh-Os-Version", "linux")
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Kimi userinfo failed: {}", e)))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        tracing::warn!(%status, "Kimi userinfo rejected the access token");
        return Err(AppError::Unauthorized(format!(
            "Kimi rejected the access token: {err_text}"
        )));
    }

    let payload: KimiTokenPayload = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse userinfo error: {}", e)))?;

    let provider_id = payload
        .sub
        .or(payload.user_id)
        .ok_or_else(|| AppError::BadRequest("Kimi userinfo missing user identifier".to_string()))?;

    kimi_user_from_identity(
        state,
        &provider_id,
        payload.name.or(payload.nickname),
        payload.email,
        payload.picture.or(payload.avatar),
    )
    .await
}

/// 由「已复核过的 Kimi 用户标识」+ 可选的资料字段建号 / 登录。
///
/// 名字 / 邮箱缺失时用占位值（`Kimi User` / `{sub 前 8 字符}@kimi.user`，见
/// `kimi_placeholder_email`）——但**占位值只发给新账号**：`find_or_create` 是 upsert，
/// 把占位值一起写进去会把已有账号的真实资料覆盖掉。2026-09-19 实测事故：userinfo
/// 故障期间兜底路径拿不到任何资料，于是每次登录都把账号昵称/邮箱写回占位值，手工改名
/// 改不牢。
///
/// 现在的规则：**本次上游给了什么就更新什么，没给的沿用库里的旧值，绝不用占位值覆盖**；
/// 库里也没有（新账号）才落占位值。上游恢复、重新带回真资料时照旧覆盖（占位值能被改回）。
async fn kimi_user_from_identity(
    state: &AppState,
    provider_id: &str,
    name: Option<String>,
    email: Option<String>,
    avatar: Option<String>,
) -> Result<User, AppError> {
    let existing = state
        .services
        .auth
        .find_by_provider("kimi", provider_id)
        .await?;

    let name = name
        .filter(|s| !s.is_empty())
        .or_else(|| existing.as_ref().map(|user| user.name.clone()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Kimi User".to_string());

    let email = email
        .filter(|s| !s.is_empty())
        .or_else(|| existing.as_ref().map(|user| user.email.clone()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| kimi_placeholder_email(provider_id));

    let avatar = avatar
        .filter(|s| !s.is_empty())
        .or_else(|| existing.and_then(|user| user.avatar));

    find_or_create_user(
        state,
        "kimi",
        provider_id,
        &name,
        &email,
        avatar.as_deref(),
    )
    .await
}

/// Kimi access token 的 JWT claims。**只在 Kimi 已经复核过这组 token 之后**才解
/// （见 `kimi_user_from_refresh_verification` 的信任边界说明）。
#[derive(Debug, Deserialize)]
struct KimiAccessTokenClaims {
    sub: Option<String>,
    user_id: Option<String>,
    iss: Option<String>,
    #[serde(rename = "type")]
    token_type: Option<String>,
}

/// Kimi 自签 token 的签发方。
const KIMI_ISSUER: &str = "kimi-auth";

/// userinfo 不可用时的兜底：用 Kimi 的 **token 端点**复核 access_token。
///
/// 背景（2026-09-18 实测）：Kimi 现在用 **ES256** 签 access token
/// （header `{"alg":"ES256","kid":"d4cbb48f…"}`，claims `iss=kimi-auth`、
/// `type=access`、`scope=kimi-code`），但它自己的 `/api/oauth/userinfo` 的算法白名单
/// 里没有 ES256 —— 对**自己刚签发**的 token 也回
/// `401 invalid user token: token signature is invalid: signing method ES256 is invalid`
/// （`/api/oauth/me` 同样）。Kimi 不暴露 JWKS（多个候选路径均 404），所以本地验签做不到。
///
/// 兜底原理：拿同一次授权返回的 `refresh_token` 去 Kimi 的 `/api/oauth/token`
/// （`grant_type=refresh_token`）。**该端点的 ES256 验签是正常的**——篡改过的
/// refresh_token 会被 `invalid_grant` 拒（实测）——因此"refresh 成功"就是 Kimi 给出的
/// "这组 token 确由我签发"的证明；证明成立后再从 access_token 里取 `sub`。
///
/// 信任边界（与已废弃的 `POST /api/auth/kimi` 的区别）：这里的 access_token 由 Kimi 的
/// token 端点**在本次请求内**返回，从不来自客户端（旧接口已 410），且使用前已经过
/// Kimi 的 refresh 复核。旧漏洞是"信任调用方提交的 JWT"，不是这个。
async fn kimi_user_from_refresh_verification(
    state: &AppState,
    refresh_token: &str,
    access_token: &str,
) -> Result<User, AppError> {
    let res = reqwest::Client::new()
        .post(format!("{}/api/oauth/token", kimi_base()))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("X-Msh-Platform", "web")
        .header("X-Msh-Version", "1.0.0")
        .header("X-Msh-Device-Name", "MoyanRust")
        .header("X-Msh-Device-Model", "server")
        .header("X-Msh-Os-Version", "linux")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", KIMI_CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Kimi refresh verification failed: {}", e)))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        tracing::warn!(%status, "Kimi refused to verify the device-flow token via refresh_token");
        return Err(AppError::Unauthorized(format!(
            "Kimi rejected the access token: {err_text}"
        )));
    }

    // 到这里 Kimi 已经确认这组 token 是真的，可以读它的 claims 了（签名不做本地校验：
    // 没有 JWKS 可依，真实性由上面的 refresh 复核保证）。
    //
    // 注意 jsonwebtoken 9 **没有** `dangerous::insecure_decode`（v8 的 API，写它会
    // 直接编译失败）：v9 的等价写法是 `insecure_disable_signature_validation()`。
    // 另外 v9 默认 required_spec_claims={"exp"}、validate_exp/validate_aud 均开启，
    // 那些校验都是"验签通过后才算数"的范畴，这里的真实性由 Kimi 的 refresh 复核
    // 替代，所以一并关掉——只管把字段读出来。
    let mut validation = Validation::new(Algorithm::HS256);
    validation.insecure_disable_signature_validation();
    validation.required_spec_claims.clear();
    validation.validate_exp = false;
    validation.validate_aud = false;
    let claims = decode::<KimiAccessTokenClaims>(
        access_token,
        &DecodingKey::from_secret(b""),
        &validation,
    )
    .map_err(|e| AppError::Unauthorized(format!("Kimi access token is not a readable JWT: {e}")))?
    .claims;

    // 防御性检查：确认是我们认识的 Kimi access token 形态（缺失的字段不拦，Kimi 以后
    // 可能改 claim 集合）。
    if let Some(iss) = claims.iss.as_deref() {
        if iss != KIMI_ISSUER {
            return Err(AppError::Unauthorized(format!(
                "Kimi access token has an unexpected issuer: {iss}"
            )));
        }
    }
    if let Some(token_type) = claims.token_type.as_deref() {
        if token_type != "access" {
            return Err(AppError::Unauthorized(format!(
                "Kimi token is not an access token: type={token_type}"
            )));
        }
    }

    let provider_id = claims
        .sub
        .or(claims.user_id)
        .ok_or_else(|| AppError::BadRequest("Kimi access token missing user identifier".to_string()))?;

    tracing::warn!(
        provider_id = %provider_id,
        "verified Kimi login via the refresh_token fallback (upstream userinfo rejects ES256 tokens)"
    );

    kimi_user_from_identity(state, &provider_id, None, None, None).await
}

/// 旧接口（已废弃）：客户端把 Kimi 的 access_token 交给我们换后端 JWT。
///
/// 为什么废弃：这里原先用 `validation.insecure_disable_signature_validation()` 本地解
/// JWT 取 `sub`，等于**信任调用方提交的身份** —— 任何人自签一个 HS256 token、把 sub
/// 填成别人的值就能拿到对方的后端 JWT（2026-09-18 实测：自签 token → 200，用返回的
/// token 读 `/api/settings` → 200，即账号接管）。Kimi 不在 JWKS 上暴露公钥，本地验签
/// 本来就做不到；正确做法是由服务端持 access_token 去 Kimi 的 userinfo 复核
/// （`kimi_user_from_access_token`），这一步已经并进 `POST /api/auth/kimi/token` ——
/// access_token 不再离开服务端。
///
/// 路由保留只为给旧客户端一个明确答复（410 而不是 404）。
pub async fn kimi_login_deprecated() -> impl axum::response::IntoResponse {
    (
        axum::http::StatusCode::GONE,
        Json(serde_json::json!({
            "success": false,
            "error": {
                "code": 410,
                "message": "此接口已废弃：请在服务端 device flow 里完成授权 \
                            （/api/auth/kimi/device → /api/auth/kimi/token），\
                            客户端不再提交 access_token。"
            }
        })),
    )
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

#[cfg(test)]
mod kimi_email_tests {
    use super::*;

    #[test]
    fn placeholder_email_slices_chars_not_bytes() {
        // ASCII：与旧的字节切片结果一致（前 8 字节 == 前 8 字符）
        assert_eq!(kimi_placeholder_email("123456789"), "12345678@kimi.user");
        // 短于 8 个字符：原样保留
        assert_eq!(kimi_placeholder_email("abc"), "abc@kimi.user");
        // 多字节：旧实现 `&provider_id[..8]` 在这里 panic（byte index is not a char boundary）
        assert_eq!(
            kimi_placeholder_email("用户名一二三四五六七八"),
            "用户名一二三四五@kimi.user"
        );
    }
}
