use axum::{body::Body, extract::Request, middleware::Next, response::Response};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::middleware::error::{AppError, AppState};
use crate::models::UserIdentity;

/// JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user id
    pub email: String,
    pub name: String,
    pub exp: usize, // expiration
    pub iat: usize, // issued at
}

/// Extract token from Authorization header
fn extract_token(req: &Request<Body>) -> Option<String> {
    req.headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|auth| auth.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

/// Legacy（非 JWT）兜底认证是否允许。**默认关闭**，只给开发环境用。
///
/// 开启时，任何无法通过 JWT 校验的 Bearer 值都会被当成「legacy token」：中间件用
/// token 的哈希当 provider_id 自动建号（见 `legacy_claims_from_token`）。也就是说
/// 线上开着它 = 任何人随手编一个 Bearer 就能读到自己名下的词库/进度数据。2026-09-18
/// 实测确认过（`Authorization: Bearer garbage` → 200），因此改成显式开关：
/// 只由 `moyan-backend/dev-run.sh` 导出 `ALLOW_LEGACY_TOKEN_AUTH=1`，
/// compose/线上不设该变量（= 关闭）。
pub fn legacy_token_auth_allowed(raw: &str) -> bool {
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// JWT authentication middleware
pub async fn jwt_middleware(mut req: Request<Body>, next: Next) -> Result<Response, AppError> {
    let state = req.extensions().get::<AppState>().cloned().ok_or_else(|| {
        AppError::Internal("AppState missing from request extensions".to_string())
    })?;

    let token = extract_token(&req)
        .ok_or_else(|| AppError::Unauthorized("Missing authorization token".to_string()))?;

    let validation = Validation::new(Algorithm::HS256);
    let decoding_key = DecodingKey::from_secret(state.jwt_secret.as_bytes());

    let claims = match decode::<Claims>(&token, &decoding_key, &validation) {
        Ok(token_data) => token_data.claims,
        Err(err) => {
            if !state.allow_legacy_token_auth {
                warn!(error = %err, "rejecting non-JWT bearer token (ALLOW_LEGACY_TOKEN_AUTH is off)");
                return Err(AppError::Unauthorized("Invalid or expired token".to_string()));
            }
            warn!("Falling back to legacy token auth (ALLOW_LEGACY_TOKEN_AUTH=1，仅限开发)");
            legacy_claims_from_token(&state, &token).await?
        }
    };

    // Store claims in request extensions for handlers to access
    req.extensions_mut().insert(claims);

    Ok(next.run(req).await)
}

async fn legacy_claims_from_token(state: &AppState, token: &str) -> Result<Claims, AppError> {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in token.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let provider_id = format!("legacy-{hash:016x}");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as usize)
        .unwrap_or(0);
    let email = format!("{provider_id}@moyan.local");
    let user = state
        .services
        .auth
        .find_or_create_user(UserIdentity {
            provider: "legacy",
            provider_id: &provider_id,
            name: "Legacy Token User",
            email: &email,
            avatar: None,
        })
        .await?;

    Ok(Claims {
        sub: user.id,
        name: "Legacy Token User".to_string(),
        email,
        exp: now + 60 * 60 * 24 * 365,
        iat: now,
    })
}

#[cfg(test)]
mod tests {
    use super::legacy_token_auth_allowed;

    #[test]
    fn legacy_token_auth_is_off_by_default_and_only_truthy_values_enable_it() {
        // 线上不设该变量 → 空串 → 必须关闭（否则任意 Bearer 都能过）
        assert!(!legacy_token_auth_allowed(""));
        assert!(!legacy_token_auth_allowed(" "));
        assert!(!legacy_token_auth_allowed("0"));
        assert!(!legacy_token_auth_allowed("false"));
        assert!(!legacy_token_auth_allowed("no"));
        assert!(!legacy_token_auth_allowed("garbage"));

        assert!(legacy_token_auth_allowed("1"));
        assert!(legacy_token_auth_allowed("true"));
        assert!(legacy_token_auth_allowed("TRUE"));
        assert!(legacy_token_auth_allowed("on"));
        assert!(legacy_token_auth_allowed("yes"));
        assert!(legacy_token_auth_allowed(" 1 "));
    }

    #[test]
    fn legacy_token_hash_is_stable() {
        fn legacy_provider_id(token: &str) -> String {
            let mut hash = 0xcbf29ce484222325u64;
            for byte in token.as_bytes() {
                hash ^= u64::from(*byte);
                hash = hash.wrapping_mul(0x100000001b3);
            }
            format!("legacy-{hash:016x}")
        }

        let first = legacy_provider_id("legacy-token");
        let second = legacy_provider_id("legacy-token");
        let third = legacy_provider_id("another-token");

        assert_eq!(first, second);
        assert_ne!(first, third);
        assert!(first.starts_with("legacy-"));
    }
}
