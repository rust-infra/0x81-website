use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{
    AdminCreateDeckRequest, AdminDeckSummary, AdminSyncSummary, AdminUpdateDeckRequest,
    AdminUserDetail, AdminUserListItem, AdminVocabularyImportCard, AdminVocabularyImportDeck,
    Card, CardExample, CardExampleInput, CreateCardRequest, Deck, ImportMode, ImportResult,
    PageQuery, PageResponse, PatchAdminUserRequest, UpdateCardRequest, User, SYSTEM_OWNER_ID,
};
use crate::repositories::Repository;
use crate::services::admin_excel::{
    build_export_xlsx, build_template_xlsx, examples_from_import_text, parse_import_xlsx,
    validate_import_rows, VocabularyExport,
};

#[derive(Clone)]
pub struct AdminService {
    repository: Arc<dyn Repository>,
}

impl AdminService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn list_decks(&self, query: PageQuery) -> Result<PageResponse<Deck>, AppError> {
        let page = query.page();
        let page_size = query.page_size();
        let offset = query.offset();
        let limit = page_size as i64;
        let q = query.q.as_deref().filter(|value| !value.trim().is_empty());

        let (items, total) = self
            .repository
            .admin_list_system_decks(q, offset, limit)
            .await?;

        Ok(PageResponse {
            items,
            page,
            page_size,
            total,
        })
    }

    pub async fn create_deck(&self, req: AdminCreateDeckRequest) -> Result<Deck, AppError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("Deck name is required".into()));
        }

        let now = Utc::now();
        let source_key = req
            .source_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| slugify(name));

        let deck = Deck {
            id: format!("deck_{}", Uuid::new_v4().simple()),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some(source_key),
            name: name.to_string(),
            description: req.description.unwrap_or_default(),
            color: req.color,
            version: 1,
            sort_order: req.sort_order.unwrap_or(0),
            is_active: req.is_active.unwrap_or(true),
            card_count: 0,
            created_at: now,
            updated_at: now,
        };

        Ok(self.repository.admin_upsert_system_deck(&deck).await?)
    }

    pub async fn update_deck(
        &self,
        deck_id: &str,
        req: AdminUpdateDeckRequest,
    ) -> Result<Deck, AppError> {
        let mut deck = self.require_system_deck(deck_id).await?;

        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() {
                return Err(AppError::BadRequest("Deck name is required".into()));
            }
            deck.name = name.to_string();
        }
        if let Some(description) = req.description {
            deck.description = description;
        }
        if let Some(color) = req.color {
            deck.color = Some(color);
        }
        if let Some(source_key) = req.source_key {
            let source_key = source_key.trim();
            if source_key.is_empty() {
                return Err(AppError::BadRequest("source_key cannot be empty".into()));
            }
            deck.source_key = Some(source_key.to_string());
        }
        if let Some(is_active) = req.is_active {
            deck.is_active = is_active;
        }
        if let Some(sort_order) = req.sort_order {
            deck.sort_order = sort_order;
        }

        deck.version += 1;
        deck.updated_at = Utc::now();

        Ok(self.repository.admin_upsert_system_deck(&deck).await?)
    }

    pub async fn delete_deck(&self, deck_id: &str) -> Result<(), AppError> {
        self.require_system_deck(deck_id).await?;
        self.repository
            .admin_delete_cards_in_deck(deck_id)
            .await?;
        let deleted = self.repository.admin_delete_system_deck(deck_id).await?;
        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("Deck not found".into()))
        }
    }

    pub async fn list_cards(
        &self,
        deck_id: &str,
        query: PageQuery,
    ) -> Result<PageResponse<Card>, AppError> {
        self.require_system_deck(deck_id).await?;

        let page = query.page();
        let page_size = query.page_size();
        let offset = query.offset();
        let limit = page_size as i64;
        let q = query.q.as_deref().filter(|value| !value.trim().is_empty());

        let (items, total) = self
            .repository
            .admin_list_cards(deck_id, q, offset, limit)
            .await?;

        Ok(PageResponse {
            items,
            page,
            page_size,
            total,
        })
    }

    pub async fn create_card(
        &self,
        deck_id: &str,
        req: CreateCardRequest,
    ) -> Result<Card, AppError> {
        self.require_system_deck(deck_id).await?;

        let front = req.front.trim();
        let back = req.back.trim();
        if front.is_empty() || back.is_empty() {
            return Err(AppError::BadRequest(
                "Card front and back are required".into(),
            ));
        }

        let examples = normalize_examples(req.examples.clone().unwrap_or_default())?;
        let req = CreateCardRequest {
            front: front.to_string(),
            back: back.to_string(),
            pronunciation: req.pronunciation,
            tags: req.tags,
            examples: None,
        };

        Ok(self
            .repository
            .create_card(deck_id, &req, examples)
            .await?)
    }

    pub async fn update_card(
        &self,
        card_id: &str,
        req: UpdateCardRequest,
    ) -> Result<Card, AppError> {
        let card = self.require_card(card_id).await?;
        self.require_system_deck(&card.deck_id).await?;

        if let Some(ref front) = req.front {
            if front.trim().is_empty() {
                return Err(AppError::BadRequest("Card front is required".into()));
            }
        }
        if let Some(ref back) = req.back {
            if back.trim().is_empty() {
                return Err(AppError::BadRequest("Card back is required".into()));
            }
        }

        let examples = match req.examples.clone() {
            Some(inputs) => Some(normalize_examples(inputs)?),
            None => None,
        };

        self.repository
            .update_card(card_id, &req, examples)
            .await?
            .ok_or_else(|| AppError::NotFound("Card not found".into()))
    }

    pub async fn delete_card(&self, card_id: &str) -> Result<(), AppError> {
        let card = self.require_card(card_id).await?;
        self.require_system_deck(&card.deck_id).await?;

        let deleted = self.repository.delete_card(card_id).await?;
        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("Card not found".into()))
        }
    }

    pub fn build_vocabulary_template_xlsx(&self) -> Result<Vec<u8>, AppError> {
        build_template_xlsx()
    }

    pub async fn export_vocabulary_xlsx(&self) -> Result<Vec<u8>, AppError> {
        let (decks, cards) = self.fetch_all_system_vocabulary().await?;
        build_export_xlsx(&decks, &cards)
    }

    pub async fn export_vocabulary_json(&self) -> Result<VocabularyExport, AppError> {
        let (decks, cards) = self.fetch_all_system_vocabulary().await?;
        Ok(VocabularyExport { decks, cards })
    }

    pub async fn list_users(
        &self,
        query: PageQuery,
    ) -> Result<PageResponse<AdminUserListItem>, AppError> {
        let page = query.page();
        let page_size = query.page_size();
        let offset = query.offset();
        let limit = page_size as i64;
        let q = query.q.as_deref().filter(|value| !value.trim().is_empty());
        let status = query
            .status
            .as_deref()
            .filter(|value| !value.trim().is_empty());
        let role = query
            .role
            .as_deref()
            .filter(|value| !value.trim().is_empty());

        let (users, total) = self
            .repository
            .admin_list_users(q, status, role, offset, limit)
            .await?;

        Ok(PageResponse {
            items: users
                .into_iter()
                .map(admin_user_list_item_from_user)
                .collect(),
            page,
            page_size,
            total,
        })
    }

    pub async fn get_user(&self, user_id: &str) -> Result<AdminUserDetail, AppError> {
        let user = self
            .repository
            .find_by_id(user_id)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".into()))?;

        let deck_summaries = self
            .repository
            .admin_user_deck_summaries(user_id)
            .await?
            .into_iter()
            .map(|(deck, card_count)| AdminDeckSummary {
                id: deck.id,
                name: deck.name,
                card_count,
                is_system: deck.owner_user_id == SYSTEM_OWNER_ID,
            })
            .collect();

        let recent_sync_count = self.repository.admin_recent_sync_count(user_id).await?;
        let sync_summary = AdminSyncSummary {
            last_sync_at: user.last_sync_at,
            recent_sync_count,
        };

        Ok(AdminUserDetail {
            user: admin_user_list_item_from_user(user),
            deck_summaries,
            sync_summary,
        })
    }

    pub async fn patch_user(
        &self,
        user_id: &str,
        req: PatchAdminUserRequest,
    ) -> Result<AdminUserListItem, AppError> {
        validate_admin_user_patch(&req)?;

        let updated = self
            .repository
            .admin_update_user(user_id, req.status.as_deref(), req.role.as_deref())
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".into()))?;

        Ok(admin_user_list_item_from_user(updated))
    }

    pub async fn import_vocabulary(
        &self,
        data: &[u8],
        mode: ImportMode,
    ) -> Result<ImportResult, AppError> {
        let (decks, cards) = parse_import_xlsx(data)?;
        let errors = validate_import_rows(&decks, &cards);
        if !errors.is_empty() {
            return Err(AppError::ImportFailed(errors));
        }

        let import_decks: Vec<AdminVocabularyImportDeck> = decks
            .into_iter()
            .map(|row| AdminVocabularyImportDeck {
                name: row.name,
                description: row.description,
                color: row.color,
                source_key: row.source_key,
            })
            .collect();
        let import_cards: Vec<AdminVocabularyImportCard> = cards
            .into_iter()
            .map(|row| AdminVocabularyImportCard {
                deck_name: row.deck_name,
                front: row.front,
                back: row.back,
                pronunciation: row.pronunciation,
                tags: row.tags,
                examples: row
                    .example
                    .as_deref()
                    .map(examples_from_import_text)
                    .unwrap_or_default(),
            })
            .collect();

        Ok(self
            .repository
            .admin_apply_vocabulary_import(mode, &import_decks, &import_cards)
            .await?)
    }

    async fn fetch_all_system_vocabulary(&self) -> Result<(Vec<Deck>, Vec<Card>), AppError> {
        let mut decks = Vec::new();
        let mut offset = 0_i64;
        loop {
            let (page, total) = self
                .repository
                .admin_list_system_decks(None, offset, 100)
                .await?;
            let fetched = page.len();
            decks.extend(page);
            offset += fetched as i64;
            if offset >= total {
                break;
            }
        }

        let mut cards = Vec::new();
        for deck in &decks {
            let mut offset = 0_i64;
            loop {
                let (page, total) = self
                    .repository
                    .admin_list_cards(&deck.id, None, offset, 100)
                    .await?;
                let fetched = page.len();
                cards.extend(page);
                offset += fetched as i64;
                if offset >= total {
                    break;
                }
            }
        }

        Ok((decks, cards))
    }

    pub async fn require_system_deck_id(&self, deck_id: &str) -> Result<Deck, AppError> {
        self.require_system_deck(deck_id).await
    }

    async fn require_system_deck(&self, deck_id: &str) -> Result<Deck, AppError> {
        let deck = self
            .repository
            .get_deck(deck_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Deck not found".into()))?;
        if deck.owner_user_id != SYSTEM_OWNER_ID {
            return Err(AppError::NotFound("Deck not found".into()));
        }
        Ok(deck)
    }

    async fn require_card(&self, card_id: &str) -> Result<Card, AppError> {
        self.repository
            .get_card(card_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Card not found".into()))
    }
}

fn admin_user_list_item_from_user(user: User) -> AdminUserListItem {
    AdminUserListItem {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
        status: user.status,
        role: user.role,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
        last_sync_at: user.last_sync_at,
    }
}

fn validate_admin_user_patch(req: &PatchAdminUserRequest) -> Result<(), AppError> {
    if let Some(ref status) = req.status {
        if status != "active" && status != "disabled" {
            return Err(AppError::BadRequest(format!("Invalid status '{status}'")));
        }
    }
    if let Some(ref role) = req.role {
        if role != "user" && role != "admin" {
            return Err(AppError::BadRequest(format!("Invalid role '{role}'")));
        }
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_hyphen = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_hyphen = false;
        } else if !last_hyphen && !slug.is_empty() {
            slug.push('-');
            last_hyphen = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn normalize_examples(inputs: Vec<CardExampleInput>) -> Result<Vec<CardExample>, AppError> {
    let mut examples = Vec::with_capacity(inputs.len());
    for input in inputs {
        let sentence_en = input.sentence_en.trim();
        let translation_zh = input.translation_zh.trim();
        if sentence_en.is_empty() || translation_zh.is_empty() {
            return Err(AppError::BadRequest(
                "Each example requires sentence_en and translation_zh".into(),
            ));
        }
        let id = input
            .id
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| format!("ex_{}", Uuid::new_v4().simple()));
        examples.push(CardExample {
            id,
            sentence_en: sentence_en.to_string(),
            translation_zh: translation_zh.to_string(),
        });
    }
    Ok(examples)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        Card, CardExample, CreateCardRequest, Deck, ImportMode, PatchAdminUserRequest, UserIdentity,
    };
    use crate::repositories::{Repository, SqliteRepositories};
    use chrono::Utc;
    use std::sync::Arc;

    #[test]
    fn slugify_normalizes_name() {
        assert_eq!(slugify("Go Core"), "go-core");
        assert_eq!(slugify("  Hello World!  "), "hello-world");
        assert_eq!(slugify("---"), "");
    }

    fn sample_deck(now: chrono::DateTime<Utc>) -> Deck {
        Deck {
            id: "deck_import_test".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("import-test".to_string()),
            name: "Import Test".to_string(),
            description: "Deck for import tests".to_string(),
            color: None,
            version: 1,
            sort_order: 0,
            is_active: true,
            card_count: 0,
            created_at: now,
            updated_at: now,
        }
    }

    async fn seeded_repo() -> Arc<dyn Repository> {
        let repo = Arc::new(
            SqliteRepositories::connect("sqlite::memory:")
                .await
                .expect("sqlite memory db"),
        ) as Arc<dyn Repository>;
        let now = Utc::now();
        repo.insert_system_deck(&sample_deck(now))
            .await
            .expect("seed deck");
        repo.create_card(
            "deck_import_test",
            &CreateCardRequest {
                front: "hello".to_string(),
                back: "old".to_string(),
                pronunciation: None,
                tags: Some(vec!["basic".to_string()]),
                examples: None,
            },
            vec![],
        )
        .await
        .expect("seed card hello");
        repo.create_card(
            "deck_import_test",
            &CreateCardRequest {
                front: "world".to_string(),
                back: "世界".to_string(),
                pronunciation: None,
                tags: None,
                examples: None,
            },
            vec![],
        )
        .await
        .expect("seed card world");
        repo
    }

    fn import_xlsx_for_cards(deck: &Deck, cards: &[(&str, &str)]) -> Vec<u8> {
        let now = Utc::now();
        let export_cards: Vec<Card> = cards
            .iter()
            .map(|(front, back)| Card {
                id: format!("card_{front}"),
                deck_id: deck.id.clone(),
                front: (*front).to_string(),
                back: (*back).to_string(),
                pronunciation: None,
                tags: vec![],
                examples: vec![],
                created_at: now,
                updated_at: now,
            })
            .collect();
        build_export_xlsx(std::slice::from_ref(deck), &export_cards)
            .expect("test xlsx should build")
    }

    #[test]
    fn validate_admin_user_patch_rejects_invalid_status() {
        let err = validate_admin_user_patch(&PatchAdminUserRequest {
            status: Some("banned".into()),
            role: None,
        })
        .expect_err("invalid status should fail");
        assert!(matches!(err, AppError::BadRequest(message) if message.contains("Invalid status")));
    }

    #[test]
    fn validate_admin_user_patch_rejects_invalid_role() {
        let err = validate_admin_user_patch(&PatchAdminUserRequest {
            status: None,
            role: Some("superadmin".into()),
        })
        .expect_err("invalid role should fail");
        assert!(matches!(err, AppError::BadRequest(message) if message.contains("Invalid role")));
    }

    async fn seeded_user_repo() -> (Arc<dyn Repository>, String) {
        let repo = Arc::new(
            SqliteRepositories::connect("sqlite::memory:")
                .await
                .expect("sqlite memory db"),
        ) as Arc<dyn Repository>;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "google",
                provider_id: "patch-test",
                name: "Patch Test",
                email: "patch@test.example",
                avatar: None,
            })
            .await
            .expect("seed user");
        (repo, user.id)
    }

    #[tokio::test]
    async fn patch_user_rejects_invalid_status_before_update() {
        let (repo, user_id) = seeded_user_repo().await;
        let service = AdminService::new(repo.clone());

        let err = service
            .patch_user(
                &user_id,
                PatchAdminUserRequest {
                    status: Some("banned".into()),
                    role: None,
                },
            )
            .await
            .expect_err("invalid status should fail");

        assert!(matches!(err, AppError::BadRequest(_)));

        let unchanged = repo
            .find_by_id(&user_id)
            .await
            .expect("lookup user")
            .expect("user should exist");
        assert_eq!(unchanged.status, "active");
    }

    #[tokio::test]
    async fn patch_user_rejects_invalid_role_before_update() {
        let (repo, user_id) = seeded_user_repo().await;
        let service = AdminService::new(repo.clone());

        let err = service
            .patch_user(
                &user_id,
                PatchAdminUserRequest {
                    status: None,
                    role: Some("superadmin".into()),
                },
            )
            .await
            .expect_err("invalid role should fail");

        assert!(matches!(err, AppError::BadRequest(_)));

        let unchanged = repo
            .find_by_id(&user_id)
            .await
            .expect("lookup user")
            .expect("user should exist");
        assert_eq!(unchanged.role, "user");
    }

    #[tokio::test]
    async fn import_merge_updates_existing_card_back() {
        let repo = seeded_repo().await;
        let service = AdminService::new(repo.clone());
        let deck = sample_deck(Utc::now());
        let xlsx = import_xlsx_for_cards(&deck, &[("hello", "updated")]);

        let result = service
            .import_vocabulary(&xlsx, ImportMode::Merge)
            .await
            .expect("merge import uses sqlite transaction and should succeed");
        assert_eq!(result.updated_cards, 1);
        assert_eq!(result.created_cards, 0);

        let updated = repo
            .admin_find_card_by_front("deck_import_test", "hello")
            .await
            .expect("lookup card")
            .expect("card should exist");
        assert_eq!(updated.back, "updated");
    }

    #[tokio::test]
    async fn import_persists_example_translation() {
        let repo = seeded_repo().await;
        let service = AdminService::new(repo.clone());
        let deck = sample_deck(Utc::now());
        let now = Utc::now();
        let card = Card {
            id: "card_example_test".to_string(),
            deck_id: deck.id.clone(),
            front: "excuse".to_string(),
            back: "原谅".to_string(),
            pronunciation: Some("/ɪkˈskjuːs/".to_string()),
            tags: vec![],
            examples: vec![CardExample {
                id: "ex_1".to_string(),
                sentence_en: "Excuse me!".to_string(),
                translation_zh: "打扰一下！".to_string(),
            }],
            created_at: now,
            updated_at: now,
        };
        let xlsx = build_export_xlsx(std::slice::from_ref(&deck), &[card])
            .expect("export xlsx should build");

        service
            .import_vocabulary(&xlsx, ImportMode::Merge)
            .await
            .expect("import with examples should succeed");

        let stored = repo
            .admin_find_card_by_front("deck_import_test", "excuse")
            .await
            .expect("lookup card")
            .expect("card should exist");
        assert_eq!(stored.examples.len(), 1);
        assert_eq!(stored.examples[0].sentence_en, "Excuse me!");
        assert_eq!(stored.examples[0].translation_zh, "打扰一下！");
    }

    #[tokio::test]
    async fn import_replace_deck_clears_cards_not_in_file() {
        let repo = seeded_repo().await;
        let service = AdminService::new(repo.clone());
        let deck = sample_deck(Utc::now());
        let xlsx = import_xlsx_for_cards(&deck, &[("hello", "updated")]);

        let result = service
            .import_vocabulary(&xlsx, ImportMode::ReplaceDeck)
            .await
            .expect("replace import should succeed");
        assert_eq!(result.created_cards, 1);

        let cards = repo
            .list_cards("deck_import_test")
            .await
            .expect("list cards");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].front, "hello");
        assert_eq!(cards[0].back, "updated");
    }
}
