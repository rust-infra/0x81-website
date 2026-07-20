use chrono::{DateTime, Utc};
use futures_util::TryStreamExt;
use mongodb::{
    Client, Collection, Database, IndexModel,
    bson::doc,
    options::{IndexOptions, ReturnDocument},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use async_trait::async_trait;

use crate::models::{
    CardData, DeckData, ReviewLogData, SyncData, SyncStatusResponse, User, UserIdentity,
    UserSettings, UserStats,
};
use crate::repositories::{
    HealthRepository, LearningRepository, RepositoryError, SettingsRepository, SyncCounts,
    UserRepository,
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
                    .options(unique)
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
        Ok(())
    }
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
