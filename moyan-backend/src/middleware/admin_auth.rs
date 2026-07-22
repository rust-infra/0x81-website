use axum::{body::Body, extract::Request, middleware::Next, response::Response};

use crate::middleware::error::{AppError, AppState};

pub fn check_admin_token(configured: &str, provided: Option<&str>) -> Result<(), AppError> {
    if configured.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "ADMIN_TOKEN is not configured".into(),
        ));
    }
    match provided {
        Some(token) if token == configured => Ok(()),
        _ => Err(AppError::Unauthorized("Invalid admin token".into())),
    }
}

pub async fn admin_token_middleware(
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let state = req.extensions().get::<AppState>().cloned().ok_or_else(|| {
        AppError::Internal("AppState missing from request extensions".to_string())
    })?;

    let provided = req
        .headers()
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok());

    check_admin_token(&state.admin_token, provided)?;
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::check_admin_token;
    use crate::middleware::error::AppError;

    #[test]
    fn empty_configured_token_returns_service_unavailable() {
        assert!(matches!(
            check_admin_token("", Some("secret")),
            Err(AppError::ServiceUnavailable(msg)) if msg == "ADMIN_TOKEN is not configured"
        ));
    }

    #[test]
    fn wrong_token_returns_unauthorized() {
        assert!(matches!(
            check_admin_token("secret", Some("wrong")),
            Err(AppError::Unauthorized(msg)) if msg == "Invalid admin token"
        ));
    }

    #[test]
    fn missing_token_returns_unauthorized() {
        assert!(matches!(
            check_admin_token("secret", None),
            Err(AppError::Unauthorized(msg)) if msg == "Invalid admin token"
        ));
    }

    #[test]
    fn matching_token_succeeds() {
        assert!(check_admin_token("secret", Some("secret")).is_ok());
    }
}
