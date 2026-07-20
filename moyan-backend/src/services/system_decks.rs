use std::sync::Arc;

use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{Card, CardExample, Deck, SYSTEM_OWNER_ID};
use crate::repositories::Repository;

const SYSTEM_VOCABULARY_JSON: &str = include_str!("../../data/system_vocabulary.json");

const SOURCE_KEYS: &[&str] = &[
    "programming-basics",
    "go-core",
    "rust-core",
    "dsa",
    "system-design",
    "database-cache",
    "network-protocols",
    "devops-cloud",
    "code-review",
    "remote-work",
    "tech-interview",
    "soft-skills",
    "30-day-vocab",
];

#[derive(Debug, Deserialize)]
struct SeedFile {
    decks: Vec<SeedDeck>,
    cards: Vec<SeedCard>,
}

#[derive(Debug, Deserialize)]
struct SeedDeck {
    name: String,
    description: String,
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SeedCard {
    #[serde(rename = "deckIndex")]
    deck_index: usize,
    front: String,
    back: String,
    example: Option<String>,
    pronunciation: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Clone)]
pub struct SystemDecksService {
    repository: Arc<dyn Repository>,
}

impl SystemDecksService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn ensure_available(&self, user_id: &str) -> Result<(), AppError> {
        let now = Utc::now();
        self.repository.touch_last_login(user_id, now).await?;

        if self.repository.count_system_decks().await? == 0 {
            self.seed_from_json(SYSTEM_VOCABULARY_JSON).await?;
        }

        if self
            .repository
            .get_system_decks_initialized_at(user_id)
            .await?
            .is_none()
        {
            self.repository
                .mark_system_decks_initialized(user_id, now)
                .await?;
        }

        Ok(())
    }

    async fn seed_from_json(&self, json: &str) -> Result<(), AppError> {
        let seed: SeedFile = serde_json::from_str(json)
            .map_err(|e| AppError::Internal(format!("Invalid system vocabulary JSON: {e}")))?;

        if seed.decks.len() != SOURCE_KEYS.len() {
            return Err(AppError::Internal(format!(
                "Expected {} system decks, found {}",
                SOURCE_KEYS.len(),
                seed.decks.len()
            )));
        }

        let now = Utc::now();
        let mut deck_ids = Vec::with_capacity(seed.decks.len());

        for (index, seed_deck) in seed.decks.iter().enumerate() {
            let id = format!("deck_{}", Uuid::new_v4().simple());
            let deck = Deck {
                id: id.clone(),
                owner_user_id: SYSTEM_OWNER_ID.to_string(),
                source_key: Some(SOURCE_KEYS[index].to_string()),
                name: seed_deck.name.clone(),
                description: seed_deck.description.clone(),
                color: seed_deck.color.clone(),
                version: 1,
                sort_order: index as i32,
                is_active: true,
                card_count: 0,
                created_at: now,
                updated_at: now,
            };
            self.repository.insert_system_deck(&deck).await?;
            deck_ids.push(id);
        }

        for seed_card in seed.cards {
            let Some(deck_id) = deck_ids.get(seed_card.deck_index) else {
                return Err(AppError::Internal(format!(
                    "Card references invalid deckIndex {}",
                    seed_card.deck_index
                )));
            };

            let examples = match seed_card.example.as_deref().map(str::trim) {
                Some(example) if !example.is_empty() => vec![CardExample {
                    id: format!("ex_{}", Uuid::new_v4().simple()),
                    sentence_en: example.to_string(),
                    translation_zh: "（暂无中文翻译）".to_string(),
                }],
                _ => Vec::new(),
            };

            let card = Card {
                id: format!("card_{}", Uuid::new_v4().simple()),
                deck_id: deck_id.clone(),
                front: seed_card.front,
                back: seed_card.back,
                pronunciation: seed_card.pronunciation,
                tags: seed_card.tags.unwrap_or_default(),
                examples,
                created_at: now,
                updated_at: now,
            };
            self.repository.insert_system_card(&card).await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserIdentity;
    use crate::repositories::{
        SqliteRepositories, UserRepository, VocabularyRepository,
    };

    const TINY_SEED: &str = r##"{
      "decks": [
        {"name":"A","description":"da","color":"#111"},
        {"name":"B","description":"db","color":"#222"},
        {"name":"C","description":"dc","color":null},
        {"name":"D","description":"dd","color":null},
        {"name":"E","description":"de","color":null},
        {"name":"F","description":"df","color":null},
        {"name":"G","description":"dg","color":null},
        {"name":"H","description":"dh","color":null},
        {"name":"I","description":"di","color":null},
        {"name":"J","description":"dj","color":null},
        {"name":"K","description":"dk","color":null},
        {"name":"L","description":"dl","color":null},
        {"name":"M","description":"dm","color":null}
      ],
      "cards": [
        {"deckIndex":0,"front":"hello","back":"你好","example":"Say hello.","pronunciation":"/həˈloʊ/","tags":["greet"]},
        {"deckIndex":0,"front":"world","back":"世界","example":"","tags":[]}
      ]
    }"##;

    #[tokio::test]
    async fn seeding_system_decks_is_idempotent() {
        let repo = Arc::new(
            SqliteRepositories::connect("sqlite::memory:")
                .await
                .expect("connect"),
        );
        let service = SystemDecksService::new(repo.clone());
        service.seed_from_json(TINY_SEED).await.expect("seed");
        assert_eq!(repo.count_system_decks().await.unwrap(), 13);
        let cards = repo
            .list_cards(
                &repo
                    .list_decks_for_user("nobody")
                    .await
                    .unwrap()
                    .into_iter()
                    .find(|d| d.source_key.as_deref() == Some("programming-basics"))
                    .unwrap()
                    .id,
            )
            .await
            .unwrap();
        assert_eq!(cards.len(), 2);
        let hello = cards.iter().find(|c| c.front == "hello").expect("hello");
        let world = cards.iter().find(|c| c.front == "world").expect("world");
        assert_eq!(hello.examples.len(), 1);
        assert_eq!(hello.examples[0].translation_zh, "（暂无中文翻译）");
        assert!(world.examples.is_empty());

        // Second seed via ensure when decks already exist should not duplicate
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "seed-user",
                name: "Seed",
                email: "seed@example.com",
                avatar: None,
            })
            .await
            .unwrap();
        service.ensure_available(&user.id).await.unwrap();
        assert_eq!(repo.count_system_decks().await.unwrap(), 13);
        assert!(
            repo.get_system_decks_initialized_at(&user.id)
                .await
                .unwrap()
                .is_some()
        );
    }
}
