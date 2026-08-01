use std::sync::Arc;

use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{
    Card, CardExample, CardExampleInput, CardProgress, CreateCardRequest, CreateDeckRequest,
    CreateReviewLogRequest, Deck, ReviewLog, StudyCard, StudyQueue, UpdateCardRequest,
    UpdateDeckRequest, UpsertCardProgressRequest, SYSTEM_OWNER_ID,
};
use crate::repositories::Repository;

const VALID_RATINGS: &[&str] = &["again", "hard", "good", "easy"];
const VALID_SRS_STATUSES: &[&str] = &["new", "learning", "review", "relearning"];
const STUDY_QUEUE_LIMIT: i64 = 50;

#[derive(Clone)]
pub struct VocabularyService {
    repository: Arc<dyn Repository>,
}

impl VocabularyService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn list_decks(&self, user_id: &str) -> Result<Vec<Deck>, AppError> {
        Ok(self.repository.list_decks_for_user(user_id).await?)
    }

    pub async fn create_deck(
        &self,
        user_id: &str,
        req: CreateDeckRequest,
    ) -> Result<Deck, AppError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("Deck name is required".into()));
        }
        let req = CreateDeckRequest {
            name: name.to_string(),
            description: req.description.map(|d| d.trim().to_string()),
            color: req.color,
        };
        Ok(self.repository.create_user_deck(user_id, &req).await?)
    }

    pub async fn update_deck(
        &self,
        user_id: &str,
        deck_id: &str,
        req: UpdateDeckRequest,
    ) -> Result<Deck, AppError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(AppError::BadRequest("Deck name is required".into()));
            }
        }
        self.repository
            .update_user_deck(user_id, deck_id, &req)
            .await?
            .ok_or_else(|| AppError::NotFound("Deck not found".into()))
    }

    pub async fn delete_deck(&self, user_id: &str, deck_id: &str) -> Result<(), AppError> {
        let deleted = self.repository.delete_user_deck(user_id, deck_id).await?;
        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("Deck not found".into()))
        }
    }

    pub async fn list_cards(&self, user_id: &str, deck_id: &str) -> Result<Vec<Card>, AppError> {
        let deck = self.require_readable_deck(user_id, deck_id).await?;
        let _ = deck;
        Ok(self.repository.list_cards(deck_id).await?)
    }

    pub async fn create_card(
        &self,
        user_id: &str,
        deck_id: &str,
        req: CreateCardRequest,
    ) -> Result<Card, AppError> {
        let deck = self.require_deck(deck_id).await?;
        ensure_user_owns_deck(&deck, user_id)?;
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
        user_id: &str,
        card_id: &str,
        req: UpdateCardRequest,
    ) -> Result<Card, AppError> {
        let card = self.require_card(card_id).await?;
        let deck = self.require_deck(&card.deck_id).await?;
        ensure_user_owns_deck(&deck, user_id)?;
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

    pub async fn delete_card(&self, user_id: &str, card_id: &str) -> Result<(), AppError> {
        let card = self.require_card(card_id).await?;
        let deck = self.require_deck(&card.deck_id).await?;
        ensure_user_owns_deck(&deck, user_id)?;
        let deleted = self.repository.delete_card(card_id).await?;
        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("Card not found".into()))
        }
    }

    pub async fn list_study_cards(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Vec<StudyCard>, AppError> {
        self.require_readable_deck(user_id, deck_id).await?;
        Ok(self.repository.list_study_cards(user_id, deck_id).await?)
    }

    pub async fn study_queue(&self, user_id: &str) -> Result<StudyQueue, AppError> {
        Ok(self
            .repository
            .study_queue(user_id, STUDY_QUEUE_LIMIT)
            .await?)
    }

    pub async fn upsert_progress(
        &self,
        user_id: &str,
        card_id: &str,
        req: UpsertCardProgressRequest,
    ) -> Result<CardProgress, AppError> {
        let card = self.require_card(card_id).await?;
        self.require_readable_deck(user_id, &card.deck_id).await?;
        if !VALID_SRS_STATUSES.contains(&req.srs_status.as_str()) {
            return Err(AppError::BadRequest("Invalid srs_status".into()));
        }
        Ok(self
            .repository
            .upsert_card_progress(user_id, card_id, &req)
            .await?)
    }

    pub async fn create_review_log(
        &self,
        user_id: &str,
        req: CreateReviewLogRequest,
    ) -> Result<ReviewLog, AppError> {
        if !VALID_RATINGS.contains(&req.rating.as_str()) {
            return Err(AppError::BadRequest("Invalid rating".into()));
        }
        let card = self.require_card(&req.card_id).await?;
        if card.deck_id != req.deck_id {
            return Err(AppError::BadRequest(
                "deck_id does not match card".into(),
            ));
        }
        self.require_readable_deck(user_id, &req.deck_id).await?;
        Ok(self.repository.create_review_log(user_id, &req).await?)
    }

    async fn require_deck(&self, deck_id: &str) -> Result<Deck, AppError> {
        self.repository
            .get_deck(deck_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Deck not found".into()))
    }

    async fn require_readable_deck(&self, user_id: &str, deck_id: &str) -> Result<Deck, AppError> {
        let deck = self.require_deck(deck_id).await?;
        ensure_readable_deck(&deck, user_id)?;
        Ok(deck)
    }

    async fn require_card(&self, card_id: &str) -> Result<Card, AppError> {
        self.repository
            .get_card(card_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Card not found".into()))
    }
}

fn ensure_user_owns_deck(deck: &Deck, user_id: &str) -> Result<(), AppError> {
    if deck.owner_user_id == user_id {
        Ok(())
    } else {
        Err(AppError::NotFound("Deck not found".into()))
    }
}

fn ensure_readable_deck(deck: &Deck, user_id: &str) -> Result<(), AppError> {
    if deck.owner_user_id == SYSTEM_OWNER_ID {
        if deck.is_active {
            Ok(())
        } else {
            Err(AppError::NotFound("Deck not found".into()))
        }
    } else if deck.owner_user_id == user_id {
        Ok(())
    } else {
        Err(AppError::NotFound("Deck not found".into()))
    }
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
    use chrono::Utc;

    #[test]
    fn system_deck_update_is_not_found() {
        let deck = Deck {
            id: "deck_sys".into(),
            owner_user_id: SYSTEM_OWNER_ID.into(),
            source_key: Some("go-core".into()),
            name: "Go".into(),
            description: String::new(),
            color: None,
            version: 1,
            sort_order: 0,
            is_active: true,
            card_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let err = ensure_user_owns_deck(&deck, "usr_1").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn own_deck_is_writable() {
        let deck = Deck {
            id: "deck_user".into(),
            owner_user_id: "usr_1".into(),
            source_key: None,
            name: "Mine".into(),
            description: String::new(),
            color: None,
            version: 1,
            sort_order: 0,
            is_active: true,
            card_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert!(ensure_user_owns_deck(&deck, "usr_1").is_ok());
    }

    #[test]
    fn inactive_system_deck_is_hidden() {
        let deck = Deck {
            id: "deck_sys".into(),
            owner_user_id: SYSTEM_OWNER_ID.into(),
            source_key: Some("go-core".into()),
            name: "Go".into(),
            description: String::new(),
            color: None,
            version: 1,
            sort_order: 0,
            is_active: false,
            card_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let err = ensure_readable_deck(&deck, "usr_1").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
