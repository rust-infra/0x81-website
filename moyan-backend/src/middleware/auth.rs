use axum::{body::Body, extract::Request, middleware::Next, response::Response};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};

use crate::middleware::error::{AppError, AppState};

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

/// JWT authentication middleware
pub async fn jwt_middleware(mut req: Request<Body>, next: Next) -> Result<Response, AppError> {
    let state = req.extensions().get::<AppState>().cloned().ok_or_else(|| {
        AppError::Internal("AppState missing from request extensions".to_string())
    })?;

    let token = extract_token(&req)
        .ok_or_else(|| AppError::Unauthorized("Missing authorization token".to_string()))?;

    let validation = Validation::new(Algorithm::HS256);
    let decoding_key = DecodingKey::from_secret(state.jwt_secret.as_bytes());

    let token_data = decode::<Claims>(&token, &decoding_key, &validation)
        .map_err(|_| AppError::Unauthorized("Invalid or expired token".to_string()))?;

    // Store claims in request extensions for handlers to access
    req.extensions_mut().insert(token_data.claims);

    Ok(next.run(req).await)
}
