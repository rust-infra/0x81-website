use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{
    AdminCreateDeckRequest, AdminUpdateDeckRequest, Card, CardExample, CardExampleInput, CreateCardRequest,
    Deck, PageQuery, PageResponse, UpdateCardRequest, SYSTEM_OWNER_ID,
};
use crate::repositories::Repository;

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

    #[test]
    fn slugify_normalizes_name() {
        assert_eq!(slugify("Go Core"), "go-core");
        assert_eq!(slugify("  Hello World!  "), "hello-world");
        assert_eq!(slugify("---"), "");
    }
}
