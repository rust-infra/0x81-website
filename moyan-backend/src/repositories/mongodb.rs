use std::collections::HashMap;

use chrono::{DateTime, Utc};
use futures_util::TryStreamExt;
use mongodb::{
    Client, Collection, Database, IndexModel,
    bson::{Document, doc},
    options::{IndexOptions, ReturnDocument},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use async_trait::async_trait;

use crate::models::{
    Card, CardData, CardExample, CardProgress, CreateCardRequest, CreateDeckRequest,
    CreateReviewLogRequest, Deck, DeckData, ReviewLog, ReviewLogData, StudyCard, SyncData,
    SyncStatusResponse, UpdateCardRequest, UpdateDeckRequest, UpsertCardProgressRequest, User,
    UserIdentity, UserSettings, UserStats, SYSTEM_OWNER_ID,
};
use crate::repositories::{
    HealthRepository, LearningRepository, RepositoryError, SettingsRepository, SyncCounts,
    UserRepository, VocabularyRepository,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeckDocument {
    user_id: String,
    #[serde(flatten)]
    data: DeckData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CardDocument {
    user_id: String,
    #[serde(flatten)]
    data: CardData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReviewLogDocument {
    user_id: String,
    #[serde(flatten)]
    data: ReviewLogData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserSettingsDocument {
    user_id: String,
    #[serde(flatten)]
    settings: UserSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VocabDeckDocument {
    id: String,
    owner_user_id: String,
    source_key: Option<String>,
    name: String,
    description: String,
    color: Option<String>,
    version: i32,
    sort_order: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl VocabDeckDocument {
    fn into_deck(self, card_count: i64) -> Deck {
        Deck {
            id: self.id,
            owner_user_id: self.owner_user_id,
            source_key: self.source_key,
            name: self.name,
            description: self.description,
            color: self.color,
            version: self.version,
            sort_order: self.sort_order,
            is_active: self.is_active,
            card_count,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl From<&Deck> for VocabDeckDocument {
    fn from(deck: &Deck) -> Self {
        Self {
            id: deck.id.clone(),
            owner_user_id: deck.owner_user_id.clone(),
            source_key: deck.source_key.clone(),
            name: deck.name.clone(),
            description: deck.description.clone(),
            color: deck.color.clone(),
            version: deck.version,
            sort_order: deck.sort_order,
            is_active: deck.is_active,
            created_at: deck.created_at,
            updated_at: deck.updated_at,
        }
    }
}

#[derive(Clone)]
pub struct MongoRepositories {
    database: Database,
}

impl MongoRepositories {
    pub async fn connect(database_url: &str, database_name: &str) -> Result<Self, RepositoryError> {
        if database_url.is_empty() {
            return Err(RepositoryError::Configuration(
                "DATABASE_URL is required for mongodb".to_string(),
            ));
        }
        let client = Client::with_uri_str(database_url).await?;
        let repository = Self {
            database: client.database(database_name),
        };
        repository.ensure_indexes().await?;
        Ok(repository)
    }

    fn users(&self) -> Collection<User> {
        self.database.collection("users")
    }
    fn decks(&self) -> Collection<DeckDocument> {
        self.database.collection("user_decks")
    }
    fn cards(&self) -> Collection<CardDocument> {
        self.database.collection("user_cards")
    }
    fn review_logs(&self) -> Collection<ReviewLogDocument> {
        self.database.collection("review_logs")
    }
    fn user_settings(&self) -> Collection<UserSettingsDocument> {
        self.database.collection("user_settings")
    }
    fn vocab_decks(&self) -> Collection<VocabDeckDocument> {
        self.database.collection("decks")
    }
    fn vocab_cards(&self) -> Collection<Card> {
        self.database.collection("cards")
    }
    fn card_progress(&self) -> Collection<CardProgress> {
        self.database.collection("card_progress")
    }
    fn review_logs_v2(&self) -> Collection<ReviewLog> {
        self.database.collection("review_logs_v2")
    }

    async fn ensure_indexes(&self) -> Result<(), RepositoryError> {
        let unique = IndexOptions::builder().unique(true).build();
        self.users()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "provider": 1, "provider_id": 1 })
                    .options(unique.clone())
                    .build(),
            )
            .await?;
        self.decks()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "user_id": 1, "id": 1 })
                    .options(unique.clone())
                    .build(),
            )
            .await?;
        self.cards()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "user_id": 1, "id": 1 })
                    .options(unique.clone())
                    .build(),
            )
            .await?;
        self.review_logs()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "user_id": 1, "id": 1 })
                    .options(unique.clone())
                    .build(),
            )
            .await?;
        self.user_settings()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "user_id": 1 })
                    .options(IndexOptions::builder().unique(true).build())
                    .build(),
            )
            .await?;

        let decks_source_unique = IndexOptions::builder()
            .unique(true)
            .partial_filter_expression(doc! {
                "source_key": { "$exists": true, "$type": "string" }
            })
            .build();
        self.vocab_decks()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1, "source_key": 1 })
                    .options(decks_source_unique)
                    .build(),
            )
            .await?;
        self.vocab_decks()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1 })
                    .build(),
            )
            .await?;
        self.vocab_cards()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "deck_id": 1 })
                    .build(),
            )
            .await?;
        self.card_progress()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1, "card_id": 1 })
                    .options(unique)
                    .build(),
            )
            .await?;
        self.card_progress()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1, "due_date": 1 })
                    .build(),
            )
            .await?;
        self.review_logs_v2()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1, "reviewed_at": 1 })
                    .build(),
            )
            .await?;
        self.review_logs_v2()
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "owner_user_id": 1, "deck_id": 1 })
                    .build(),
            )
            .await?;
        Ok(())
    }

    async fn count_cards_for_deck(&self, deck_id: &str) -> Result<i64, RepositoryError> {
        to_i64(
            self.vocab_cards()
                .count_documents(doc! { "deck_id": deck_id })
                .await?,
            "card count",
        )
    }

    async fn deck_from_document(
        &self,
        document: VocabDeckDocument,
    ) -> Result<Deck, RepositoryError> {
        let card_count = self.count_cards_for_deck(&document.id).await?;
        Ok(document.into_deck(card_count))
    }

    async fn delete_card_cascade(&self, card_id: &str) -> Result<bool, RepositoryError> {
        let result = self
            .vocab_cards()
            .delete_one(doc! { "id": card_id })
            .await?;
        if result.deleted_count == 0 {
            return Ok(false);
        }
        self.card_progress()
            .delete_many(doc! { "card_id": card_id })
            .await?;
        self.review_logs_v2()
            .delete_many(doc! { "card_id": card_id })
            .await?;
        Ok(true)
    }
}

fn new_prefixed_id(prefix: &str) -> String {
    format!("{prefix}{}", Uuid::new_v4().simple())
}

impl From<mongodb::error::Error> for RepositoryError {
    fn from(error: mongodb::error::Error) -> Self {
        Self::Persistence(error.to_string())
    }
}

#[async_trait]
impl UserRepository for MongoRepositories {
    async fn find_or_create(&self, identity: UserIdentity<'_>) -> Result<User, RepositoryError> {
        let filter = doc! { "provider": identity.provider, "provider_id": identity.provider_id };
        let now = Utc::now();
        self.users()
            .find_one_and_update(
                filter,
                doc! {
                    "$set": {
                        "email": identity.email,
                        "name": identity.name,
                        "avatar": identity.avatar,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "id": format!("usr_{}", Uuid::new_v4().simple()),
                        "provider": identity.provider,
                        "provider_id": identity.provider_id,
                        "created_at": now,
                        "last_sync_at": null,
                        "status": "active",
                        "role": "user",
                        "last_login_at": null,
                        "system_decks_initialized_at": null,
                    }
                },
            )
            .upsert(true)
            .return_document(ReturnDocument::After)
            .await?
            .ok_or_else(|| {
                RepositoryError::Configuration("mongodb upsert returned no user".to_string())
            })
    }

    async fn find_by_id(&self, user_id: &str) -> Result<Option<User>, RepositoryError> {
        Ok(self.users().find_one(doc! { "id": user_id }).await?)
    }

    async fn admin_list_users(
        &self,
        q: Option<&str>,
        status: Option<&str>,
        role: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<User>, i64), RepositoryError> {
        let mut filter = Document::new();
        if let Some(q) = q {
            filter.insert(
                "$or",
                vec![
                    doc! { "email": { "$regex": q, "$options": "i" } },
                    doc! { "name": { "$regex": q, "$options": "i" } },
                    doc! { "id": { "$regex": q, "$options": "i" } },
                ],
            );
        }
        if let Some(status) = status {
            filter.insert("status", status);
        }
        if let Some(role) = role {
            filter.insert("role", role);
        }

        let total = to_i64(
            self.users().count_documents(filter.clone()).await?,
            "admin users total",
        )?;
        let users = self
            .users()
            .find(filter)
            .sort(doc! { "created_at": -1, "id": 1 })
            .skip(offset.max(0) as u64)
            .limit(limit)
            .await?
            .try_collect::<Vec<_>>()
            .await?;
        Ok((users, total))
    }

    async fn admin_update_user(
        &self,
        user_id: &str,
        status: Option<&str>,
        role: Option<&str>,
    ) -> Result<Option<User>, RepositoryError> {
        let Some(existing) = self.find_by_id(user_id).await? else {
            return Ok(None);
        };
        let status = status.unwrap_or(&existing.status);
        let role = role.unwrap_or(&existing.role);

        self.users()
            .update_one(
                doc! { "id": user_id },
                doc! {
                    "$set": {
                        "status": status,
                        "role": role,
                        "updated_at": Utc::now(),
                    }
                },
            )
            .await?;
        self.find_by_id(user_id).await
    }

    async fn admin_user_deck_summaries(
        &self,
        user_id: &str,
    ) -> Result<Vec<(Deck, i64)>, RepositoryError> {
        let documents = self
            .vocab_decks()
            .find(doc! { "owner_user_id": user_id })
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut summaries = Vec::with_capacity(documents.len());
        for document in documents {
            let deck = self.deck_from_document(document).await?;
            let card_count = deck.card_count;
            summaries.push((deck, card_count));
        }
        Ok(summaries)
    }

    async fn admin_recent_sync_count(&self, _user_id: &str) -> Result<i64, RepositoryError> {
        Ok(0)
    }
}

#[async_trait]
impl LearningRepository for MongoRepositories {
    async fn upload(
        &self,
        user_id: &str,
        data: &SyncData,
        synced_at: DateTime<Utc>,
    ) -> Result<SyncCounts, RepositoryError> {
        for deck in &data.decks {
            let document = DeckDocument {
                user_id: user_id.to_string(),
                data: deck.clone(),
            };
            self.decks()
                .replace_one(doc! { "user_id": user_id, "id": &deck.id }, document)
                .upsert(true)
                .await?;
        }
        for card in &data.cards {
            let document = CardDocument {
                user_id: user_id.to_string(),
                data: card.clone(),
            };
            self.cards()
                .replace_one(doc! { "user_id": user_id, "id": &card.id }, document)
                .upsert(true)
                .await?;
        }
        for log in &data.review_logs {
            let document = ReviewLogDocument {
                user_id: user_id.to_string(),
                data: log.clone(),
            };
            self.review_logs()
                .replace_one(doc! { "user_id": user_id, "id": &log.id }, document)
                .upsert(true)
                .await?;
        }
        self.users()
            .update_one(
                doc! { "id": user_id },
                doc! { "$set": { "last_sync_at": synced_at, "updated_at": synced_at } },
            )
            .await?;

        Ok(SyncCounts {
            decks: data.decks.len(),
            cards: data.cards.len(),
            logs: data.review_logs.len(),
        })
    }

    async fn download(&self, user_id: &str) -> Result<SyncData, RepositoryError> {
        let decks = self
            .decks()
            .find(doc! { "user_id": user_id })
            .await?
            .try_collect::<Vec<_>>()
            .await?
            .into_iter()
            .map(|document| document.data)
            .collect();
        let cards = self
            .cards()
            .find(doc! { "user_id": user_id })
            .await?
            .try_collect::<Vec<_>>()
            .await?
            .into_iter()
            .map(|document| document.data)
            .collect();
        let review_logs = self
            .review_logs()
            .find(doc! { "user_id": user_id })
            .await?
            .try_collect::<Vec<_>>()
            .await?
            .into_iter()
            .map(|document| document.data)
            .collect();
        Ok(SyncData {
            decks,
            cards,
            review_logs,
            settings: None,
            sync_timestamp: Utc::now(),
        })
    }

    async fn status(&self, user_id: &str) -> Result<SyncStatusResponse, RepositoryError> {
        let last_sync_at = self
            .find_by_id(user_id)
            .await?
            .and_then(|user| user.last_sync_at);
        let cards_count = to_i64(
            self.cards()
                .count_documents(doc! { "user_id": user_id })
                .await?,
            "cards count",
        )?;
        let decks_count = to_i64(
            self.decks()
                .count_documents(doc! { "user_id": user_id })
                .await?,
            "decks count",
        )?;
        Ok(SyncStatusResponse {
            last_sync_at,
            has_data: cards_count > 0,
            cards_count,
            decks_count,
        })
    }

    async fn stats(&self, user_id: &str) -> Result<UserStats, RepositoryError> {
        Ok(UserStats {
            cards_count: to_i64(
                self.cards()
                    .count_documents(doc! { "user_id": user_id })
                    .await?,
                "cards count",
            )?,
            decks_count: to_i64(
                self.decks()
                    .count_documents(doc! { "user_id": user_id })
                    .await?,
                "decks count",
            )?,
            reviews_count: to_i64(
                self.review_logs()
                    .count_documents(doc! { "user_id": user_id })
                    .await?,
                "reviews count",
            )?,
        })
    }
}

#[async_trait]
impl SettingsRepository for MongoRepositories {
    async fn get_settings(&self, user_id: &str) -> Result<UserSettings, RepositoryError> {
        Ok(self
            .user_settings()
            .find_one(doc! { "user_id": user_id })
            .await?
            .map(|document| document.settings)
            .unwrap_or_default())
    }

    async fn save_settings(
        &self,
        user_id: &str,
        settings: &UserSettings,
    ) -> Result<UserSettings, RepositoryError> {
        self.user_settings()
            .replace_one(
                doc! { "user_id": user_id },
                UserSettingsDocument {
                    user_id: user_id.to_string(),
                    settings: settings.clone(),
                },
            )
            .upsert(true)
            .await?;

        Ok(settings.clone())
    }
}

#[async_trait]
impl VocabularyRepository for MongoRepositories {
    async fn list_decks_for_user(&self, user_id: &str) -> Result<Vec<Deck>, RepositoryError> {
        let documents = self
            .vocab_decks()
            .find(doc! {
                "$or": [
                    { "owner_user_id": SYSTEM_OWNER_ID, "is_active": true },
                    { "owner_user_id": user_id },
                ]
            })
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut decks = Vec::with_capacity(documents.len());
        for document in documents {
            decks.push(self.deck_from_document(document).await?);
        }
        decks.sort_by(|left, right| {
            let left_system = left.owner_user_id == SYSTEM_OWNER_ID;
            let right_system = right.owner_user_id == SYSTEM_OWNER_ID;
            right_system
                .cmp(&left_system)
                .then(left.sort_order.cmp(&right.sort_order))
                .then(left.name.cmp(&right.name))
        });
        Ok(decks)
    }

    async fn get_deck(&self, deck_id: &str) -> Result<Option<Deck>, RepositoryError> {
        let Some(document) = self
            .vocab_decks()
            .find_one(doc! { "id": deck_id })
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(self.deck_from_document(document).await?))
    }

    async fn create_user_deck(
        &self,
        user_id: &str,
        req: &CreateDeckRequest,
    ) -> Result<Deck, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("deck_");
        let document = VocabDeckDocument {
            id: id.clone(),
            owner_user_id: user_id.to_string(),
            source_key: None,
            name: req.name.clone(),
            description: req.description.clone().unwrap_or_default(),
            color: req.color.clone(),
            version: 1,
            sort_order: 0,
            is_active: true,
            created_at: now,
            updated_at: now,
        };
        self.vocab_decks().insert_one(document).await?;
        self.get_deck(&id)
            .await?
            .ok_or_else(|| RepositoryError::Persistence("created deck missing".to_string()))
    }

    async fn update_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
        req: &UpdateDeckRequest,
    ) -> Result<Option<Deck>, RepositoryError> {
        let Some(existing) = self.get_deck(deck_id).await? else {
            return Ok(None);
        };
        if existing.owner_user_id != user_id {
            return Ok(None);
        }

        let now = Utc::now();
        let name = req.name.as_deref().unwrap_or(&existing.name);
        let description = req
            .description
            .as_deref()
            .unwrap_or(&existing.description);
        let color = req.color.as_ref().or(existing.color.as_ref());

        let result = self
            .vocab_decks()
            .update_one(
                doc! { "id": deck_id, "owner_user_id": user_id },
                doc! {
                    "$set": {
                        "name": name,
                        "description": description,
                        "color": color,
                        "updated_at": now,
                    }
                },
            )
            .await?;
        if result.matched_count == 0 {
            return Ok(None);
        }
        self.get_deck(deck_id).await
    }

    async fn delete_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<bool, RepositoryError> {
        let result = self
            .vocab_decks()
            .delete_one(doc! { "id": deck_id, "owner_user_id": user_id })
            .await?;
        if result.deleted_count == 0 {
            return Ok(false);
        }

        let cards = self.list_cards(deck_id).await?;
        let card_ids: Vec<String> = cards.into_iter().map(|card| card.id).collect();
        if !card_ids.is_empty() {
            self.card_progress()
                .delete_many(doc! { "card_id": { "$in": &card_ids } })
                .await?;
            self.review_logs_v2()
                .delete_many(doc! {
                    "$or": [
                        { "deck_id": deck_id },
                        { "card_id": { "$in": &card_ids } },
                    ]
                })
                .await?;
            self.vocab_cards()
                .delete_many(doc! { "deck_id": deck_id })
                .await?;
        } else {
            self.review_logs_v2()
                .delete_many(doc! { "deck_id": deck_id })
                .await?;
        }
        Ok(true)
    }

    async fn list_cards(&self, deck_id: &str) -> Result<Vec<Card>, RepositoryError> {
        Ok(self
            .vocab_cards()
            .find(doc! { "deck_id": deck_id })
            .sort(doc! { "created_at": 1, "id": 1 })
            .await?
            .try_collect()
            .await?)
    }

    async fn get_card(&self, card_id: &str) -> Result<Option<Card>, RepositoryError> {
        Ok(self.vocab_cards().find_one(doc! { "id": card_id }).await?)
    }

    async fn create_card(
        &self,
        deck_id: &str,
        req: &CreateCardRequest,
        examples: Vec<CardExample>,
    ) -> Result<Card, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("card_");
        let card = Card {
            id: id.clone(),
            deck_id: deck_id.to_string(),
            front: req.front.clone(),
            back: req.back.clone(),
            pronunciation: req.pronunciation.clone(),
            tags: req.tags.clone().unwrap_or_default(),
            examples,
            created_at: now,
            updated_at: now,
        };
        self.vocab_cards().insert_one(card).await?;
        self.get_card(&id)
            .await?
            .ok_or_else(|| RepositoryError::Persistence("created card missing".to_string()))
    }

    async fn update_card(
        &self,
        card_id: &str,
        req: &UpdateCardRequest,
        examples: Option<Vec<CardExample>>,
    ) -> Result<Option<Card>, RepositoryError> {
        let Some(existing) = self.get_card(card_id).await? else {
            return Ok(None);
        };

        let now = Utc::now();
        let front = req.front.as_deref().unwrap_or(&existing.front);
        let back = req.back.as_deref().unwrap_or(&existing.back);
        let pronunciation = match &req.pronunciation {
            Some(value) => Some(value.as_str()),
            None => existing.pronunciation.as_deref(),
        };
        let tags = req.tags.as_ref().unwrap_or(&existing.tags);
        let examples = examples.as_ref().unwrap_or(&existing.examples);

        let result = self
            .vocab_cards()
            .update_one(
                doc! { "id": card_id },
                doc! {
                    "$set": {
                        "front": front,
                        "back": back,
                        "pronunciation": pronunciation,
                        "tags": tags,
                        "examples": mongodb::bson::to_bson(examples).map_err(|error| {
                            RepositoryError::Persistence(error.to_string())
                        })?,
                        "updated_at": now,
                    }
                },
            )
            .await?;
        if result.matched_count == 0 {
            return Ok(None);
        }
        self.get_card(card_id).await
    }

    async fn delete_card(&self, card_id: &str) -> Result<bool, RepositoryError> {
        self.delete_card_cascade(card_id).await
    }

    async fn list_study_cards(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Vec<StudyCard>, RepositoryError> {
        let cards = self.list_cards(deck_id).await?;
        if cards.is_empty() {
            return Ok(Vec::new());
        }

        let card_ids: Vec<String> = cards.iter().map(|card| card.id.clone()).collect();
        let progresses = self
            .card_progress()
            .find(doc! {
                "owner_user_id": user_id,
                "card_id": { "$in": card_ids },
            })
            .await?
            .try_collect::<Vec<_>>()
            .await?;
        let progress_by_card: HashMap<String, CardProgress> = progresses
            .into_iter()
            .map(|progress| (progress.card_id.clone(), progress))
            .collect();

        Ok(cards
            .into_iter()
            .map(|card| {
                let progress = progress_by_card.get(&card.id).cloned();
                StudyCard { card, progress }
            })
            .collect())
    }

    async fn upsert_card_progress(
        &self,
        user_id: &str,
        card_id: &str,
        req: &UpsertCardProgressRequest,
    ) -> Result<CardProgress, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("prog_");
        self.card_progress()
            .find_one_and_update(
                doc! { "owner_user_id": user_id, "card_id": card_id },
                doc! {
                    "$set": {
                        "srs_status": &req.srs_status,
                        "interval": req.interval,
                        "repetitions": req.repetitions,
                        "ease_factor": req.ease_factor,
                        "due_date": req.due_date,
                        "last_reviewed_at": req.last_reviewed_at,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "id": id,
                        "owner_user_id": user_id,
                        "card_id": card_id,
                        "created_at": now,
                    }
                },
            )
            .upsert(true)
            .return_document(ReturnDocument::After)
            .await?
            .ok_or_else(|| {
                RepositoryError::Persistence("upserted card progress missing".to_string())
            })
    }

    async fn create_review_log(
        &self,
        user_id: &str,
        req: &CreateReviewLogRequest,
    ) -> Result<ReviewLog, RepositoryError> {
        let log = ReviewLog {
            id: new_prefixed_id("rev_"),
            owner_user_id: user_id.to_string(),
            card_id: req.card_id.clone(),
            deck_id: req.deck_id.clone(),
            rating: req.rating.clone(),
            time_ms: req.time_ms,
            reviewed_at: req.reviewed_at.unwrap_or_else(Utc::now),
        };
        self.review_logs_v2().insert_one(log.clone()).await?;
        Ok(log)
    }

    async fn count_system_decks(&self) -> Result<i64, RepositoryError> {
        to_i64(
            self.vocab_decks()
                .count_documents(doc! { "owner_user_id": SYSTEM_OWNER_ID })
                .await?,
            "system decks count",
        )
    }

    async fn insert_system_deck(&self, deck: &Deck) -> Result<(), RepositoryError> {
        self.vocab_decks()
            .insert_one(VocabDeckDocument::from(deck))
            .await?;
        Ok(())
    }

    async fn insert_system_card(&self, card: &Card) -> Result<(), RepositoryError> {
        self.vocab_cards().insert_one(card.clone()).await?;
        Ok(())
    }

    async fn mark_system_decks_initialized(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError> {
        self.users()
            .update_one(
                doc! { "id": user_id },
                doc! { "$set": { "system_decks_initialized_at": at } },
            )
            .await?;
        Ok(())
    }

    async fn get_system_decks_initialized_at(
        &self,
        user_id: &str,
    ) -> Result<Option<DateTime<Utc>>, RepositoryError> {
        Ok(self
            .find_by_id(user_id)
            .await?
            .and_then(|user| user.system_decks_initialized_at))
    }

    async fn touch_last_login(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError> {
        self.users()
            .update_one(
                doc! { "id": user_id },
                doc! { "$set": { "last_login_at": at } },
            )
            .await?;
        Ok(())
    }

    async fn admin_list_system_decks(
        &self,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Deck>, i64), RepositoryError> {
        let filter = admin_deck_filter(q);
        let total = to_i64(
            self.vocab_decks().count_documents(filter.clone()).await?,
            "admin system decks total",
        )?;
        let documents = self
            .vocab_decks()
            .find(filter)
            .sort(doc! { "sort_order": 1, "name": 1 })
            .skip(offset.max(0) as u64)
            .limit(limit)
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut decks = Vec::with_capacity(documents.len());
        for document in documents {
            decks.push(self.deck_from_document(document).await?);
        }
        Ok((decks, total))
    }

    async fn admin_list_cards(
        &self,
        deck_id: &str,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Card>, i64), RepositoryError> {
        let mut filter = doc! { "deck_id": deck_id };
        if let Some(q) = q {
            filter.insert(
                "$or",
                vec![
                    doc! { "front": { "$regex": q, "$options": "i" } },
                    doc! { "back": { "$regex": q, "$options": "i" } },
                    doc! { "tags": { "$regex": q, "$options": "i" } },
                ],
            );
        }

        let total = to_i64(
            self.vocab_cards().count_documents(filter.clone()).await?,
            "admin cards total",
        )?;
        let cards = self
            .vocab_cards()
            .find(filter)
            .sort(doc! { "created_at": 1, "id": 1 })
            .skip(offset.max(0) as u64)
            .limit(limit)
            .await?
            .try_collect::<Vec<_>>()
            .await?;
        Ok((cards, total))
    }

    async fn admin_find_system_deck_by_source_key(
        &self,
        source_key: &str,
    ) -> Result<Option<Deck>, RepositoryError> {
        let Some(document) = self
            .vocab_decks()
            .find_one(doc! { "owner_user_id": SYSTEM_OWNER_ID, "source_key": source_key })
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(self.deck_from_document(document).await?))
    }

    async fn admin_find_system_deck_by_name(
        &self,
        name: &str,
    ) -> Result<Option<Deck>, RepositoryError> {
        let Some(document) = self
            .vocab_decks()
            .find_one(doc! { "owner_user_id": SYSTEM_OWNER_ID, "name": name })
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(self.deck_from_document(document).await?))
    }

    async fn admin_upsert_system_deck(&self, deck: &Deck) -> Result<Deck, RepositoryError> {
        self.vocab_decks()
            .replace_one(doc! { "id": &deck.id }, VocabDeckDocument::from(deck))
            .upsert(true)
            .await?;
        self.get_deck(&deck.id)
            .await?
            .ok_or_else(|| RepositoryError::Persistence("upserted deck missing".to_string()))
    }

    async fn admin_delete_cards_in_deck(&self, deck_id: &str) -> Result<u64, RepositoryError> {
        let result = self
            .vocab_cards()
            .delete_many(doc! { "deck_id": deck_id })
            .await?;
        Ok(result.deleted_count)
    }

    async fn admin_delete_system_deck(&self, deck_id: &str) -> Result<bool, RepositoryError> {
        let result = self
            .vocab_decks()
            .delete_one(doc! { "id": deck_id, "owner_user_id": SYSTEM_OWNER_ID })
            .await?;
        Ok(result.deleted_count > 0)
    }

    async fn admin_find_card_by_front(
        &self,
        deck_id: &str,
        front: &str,
    ) -> Result<Option<Card>, RepositoryError> {
        Ok(self
            .vocab_cards()
            .find_one(doc! { "deck_id": deck_id, "front": front })
            .await?)
    }
}

fn admin_deck_filter(q: Option<&str>) -> Document {
    let mut filter = doc! { "owner_user_id": SYSTEM_OWNER_ID };
    if let Some(q) = q {
        filter.insert(
            "$or",
            vec![
                doc! { "name": { "$regex": q, "$options": "i" } },
                doc! { "description": { "$regex": q, "$options": "i" } },
                doc! { "source_key": { "$regex": q, "$options": "i" } },
            ],
        );
    }
    filter
}

fn to_i64(value: u64, field: &'static str) -> Result<i64, RepositoryError> {
    i64::try_from(value).map_err(|_| RepositoryError::NumericConversion(field))
}

#[async_trait]
impl HealthRepository for MongoRepositories {
    async fn is_healthy(&self) -> bool {
        self.database.run_command(doc! { "ping": 1 }).await.is_ok()
    }

    fn backend_name(&self) -> &'static str {
        "mongodb"
    }
}
