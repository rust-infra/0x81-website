use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct PageQuery {
    pub q: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub status: Option<String>,
    pub role: Option<String>,
}

impl PageQuery {
    pub fn page(&self) -> u32 {
        self.page.unwrap_or(1).max(1)
    }

    pub fn page_size(&self) -> u32 {
        self.page_size.unwrap_or(20).clamp(1, 100)
    }

    pub fn offset(&self) -> i64 {
        ((self.page() - 1) * self.page_size()) as i64
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PageResponse<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub page_size: u32,
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdminCreateDeckRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub source_key: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdminUpdateDeckRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub source_key: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminUserListItem {
    pub id: String,
    pub email: String,
    pub name: String,
    pub provider: String,
    pub status: String,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchAdminUserRequest {
    pub status: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminUserDetail {
    pub user: AdminUserListItem,
    pub deck_summaries: Vec<AdminDeckSummary>,
    pub sync_summary: AdminSyncSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminDeckSummary {
    pub id: String,
    pub name: String,
    pub card_count: i64,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminSyncSummary {
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    pub recent_sync_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportErrorItem {
    pub sheet: String,
    pub row: u32,
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub created_decks: u32,
    pub updated_decks: u32,
    pub created_cards: u32,
    pub updated_cards: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    Merge,
    ReplaceDeck,
}

#[derive(Debug, Clone)]
pub struct AdminVocabularyImportDeck {
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub source_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AdminVocabularyImportCard {
    pub deck_name: String,
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    pub tags: Vec<String>,
    pub examples: Vec<super::CardExample>,
}

impl ImportMode {
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("merge") {
            "merge" => Ok(Self::Merge),
            "replace_deck" => Ok(Self::ReplaceDeck),
            other => Err(format!("invalid mode '{other}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_size_clamps_to_valid_range() {
        let query = PageQuery {
            q: None,
            page: None,
            page_size: Some(500),
            sort: None,
            order: None,
            status: None,
            role: None,
        };
        assert_eq!(query.page_size(), 100);

        let query = PageQuery {
            q: None,
            page: None,
            page_size: Some(0),
            sort: None,
            order: None,
            status: None,
            role: None,
        };
        assert_eq!(query.page_size(), 1);
    }

    #[test]
    fn import_mode_parse_accepts_known_values() {
        assert_eq!(ImportMode::parse(None).unwrap(), ImportMode::Merge);
        assert_eq!(
            ImportMode::parse(Some("merge")).unwrap(),
            ImportMode::Merge
        );
        assert_eq!(
            ImportMode::parse(Some("replace_deck")).unwrap(),
            ImportMode::ReplaceDeck
        );
        assert!(ImportMode::parse(Some("unknown")).is_err());
    }
}
