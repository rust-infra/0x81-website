//! Application entities and HTTP request/response data transfer objects.

mod admin;
mod admin_collect;
mod learning;
mod user;
mod vocabulary;

pub use admin::*;
pub use admin_collect::*;
pub use learning::*;
pub use user::*;
pub use vocabulary::*;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar: Option<String>,
    pub provider: String,
    pub created_at: DateTime<Utc>,
    pub last_sync_at: Option<DateTime<Utc>>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
            provider: user.provider,
            created_at: user.created_at,
            last_sync_at: user.last_sync_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KimiAuthRequest {
    pub access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KimiTokenPayload {
    pub sub: Option<String>,
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub picture: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserInfo {
    pub sub: String,
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadRequest {
    pub data: SyncData,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    pub sync_id: String,
    pub cards_synced: usize,
    pub decks_synced: usize,
    pub logs_synced: usize,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettingsRequest {
    pub settings: UserSettings,
}
