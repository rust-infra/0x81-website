use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar: Option<String>,
    pub provider: String,
    pub provider_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_sync_at: Option<DateTime<Utc>>,
    #[serde(default = "default_user_status")]
    pub status: String,
    #[serde(default = "default_user_role")]
    pub role: String,
    pub last_login_at: Option<DateTime<Utc>>,
    pub system_decks_initialized_at: Option<DateTime<Utc>>,
}

fn default_user_status() -> String {
    "active".to_string()
}

fn default_user_role() -> String {
    "user".to_string()
}

#[derive(Debug, Clone)]
pub struct UserIdentity<'a> {
    pub provider: &'a str,
    pub provider_id: &'a str,
    pub name: &'a str,
    pub email: &'a str,
    pub avatar: Option<&'a str>,
}
