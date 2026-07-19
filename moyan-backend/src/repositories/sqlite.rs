use chrono::{DateTime, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use uuid::Uuid;

use async_trait::async_trait;

use crate::models::{
    CardData, DeckData, ReviewLogData, SyncData, SyncStatusResponse, User, UserIdentity, UserStats,
};
use crate::repositories::{
    HealthRepository, LearningRepository, RepositoryError, SyncCounts, UserRepository,
};

#[derive(Clone)]
pub struct SqliteRepositories {
    pool: SqlitePool,
}

#[derive(sqlx::FromRow)]
struct UserRow {
    id: String,
    email: String,
    name: String,
    avatar: Option<String>,
    provider: String,
    provider_id: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_sync_at: Option<DateTime<Utc>>,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            name: row.name,
            avatar: row.avatar,
            provider: row.provider,
            provider_id: row.provider_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_sync_at: row.last_sync_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct DeckRow {
    id: String,
    name: String,
    description: Option<String>,
    category: Option<String>,
    card_count: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<DeckRow> for DeckData {
    fn from(row: DeckRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            card_count: row.card_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct CardRow {
    id: String,
    deck_id: String,
    front: String,
    back: String,
    example: Option<String>,
    pronunciation: Option<String>,
    tags: Option<String>,
    srs_level: i32,
    srs_status: String,
    srs_next_review: Option<DateTime<Utc>>,
    srs_interval: f64,
    srs_ease: f64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CardRow> for CardData {
    fn from(row: CardRow) -> Self {
        Self {
            id: row.id,
            deck_id: row.deck_id,
            front: row.front,
            back: row.back,
            example: row.example,
            pronunciation: row.pronunciation,
            tags: row.tags,
            srs_level: row.srs_level,
            srs_status: row.srs_status,
            srs_next_review: row.srs_next_review,
            srs_interval: row.srs_interval,
            srs_ease: row.srs_ease,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ReviewLogRow {
    id: String,
    card_id: String,
    rating: String,
    reviewed_at: DateTime<Utc>,
    time_ms: Option<i32>,
}

impl From<ReviewLogRow> for ReviewLogData {
    fn from(row: ReviewLogRow) -> Self {
        Self {
            id: row.id,
            card_id: row.card_id,
            rating: row.rating,
            reviewed_at: row.reviewed_at,
            time_ms: row.time_ms,
        }
    }
}

impl SqliteRepositories {
    pub async fn connect(database_url: &str) -> Result<Self, RepositoryError> {
        let mut options = database_url
            .parse::<SqliteConnectOptions>()?
            .create_if_missing(true);

        let filename = options.get_filename().to_path_buf();
        let is_in_memory = database_url.contains(":memory:");
        if !filename.as_os_str().is_empty() && filename != std::path::Path::new(":memory:") {
            let path = filename.as_path();
            if !path.is_absolute() {
                options = options.filename(std::env::current_dir()?.join(path));
            }
            if let Some(parent) = options.get_filename().parent() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let pool = SqlitePoolOptions::new()
            .max_connections(if is_in_memory { 1 } else { 5 })
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }
}

impl From<std::io::Error> for RepositoryError {
    fn from(error: std::io::Error) -> Self {
        Self::Persistence(error.to_string())
    }
}

impl From<sqlx::Error> for RepositoryError {
    fn from(error: sqlx::Error) -> Self {
        Self::Persistence(error.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for RepositoryError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Persistence(error.to_string())
    }
}

#[async_trait]
impl UserRepository for SqliteRepositories {
    async fn find_or_create(&self, identity: UserIdentity<'_>) -> Result<User, RepositoryError> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO users (id, email, name, avatar, provider, provider_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider, provider_id) DO UPDATE SET
             email = excluded.email, name = excluded.name, avatar = excluded.avatar,
             updated_at = excluded.updated_at",
        )
        .bind(format!("usr_{}", Uuid::new_v4().simple()))
        .bind(identity.email)
        .bind(identity.name)
        .bind(identity.avatar)
        .bind(identity.provider)
        .bind(identity.provider_id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(sqlx::query_as::<_, UserRow>(
            "SELECT * FROM users WHERE provider = ? AND provider_id = ?",
        )
        .bind(identity.provider)
        .bind(identity.provider_id)
        .fetch_one(&self.pool)
        .await?
        .into())
    }

    async fn find_by_id(&self, user_id: &str) -> Result<Option<User>, RepositoryError> {
        Ok(
            sqlx::query_as::<_, UserRow>("SELECT * FROM users WHERE id = ?")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?
                .map(Into::into),
        )
    }
}

#[async_trait]
impl LearningRepository for SqliteRepositories {
    async fn upload(
        &self,
        user_id: &str,
        data: &SyncData,
        synced_at: DateTime<Utc>,
    ) -> Result<SyncCounts, RepositoryError> {
        let mut tx = self.pool.begin().await?;

        for deck in &data.decks {
            sqlx::query(
                "INSERT INTO user_decks (id, user_id, name, description, category, card_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
                 category = excluded.category, card_count = excluded.card_count, updated_at = excluded.updated_at
                 WHERE user_decks.user_id = excluded.user_id",
            )
            .bind(&deck.id).bind(user_id).bind(&deck.name).bind(&deck.description)
            .bind(&deck.category).bind(deck.card_count).bind(deck.created_at).bind(deck.updated_at)
            .execute(&mut *tx).await?;
        }

        for card in &data.cards {
            sqlx::query(
                "INSERT INTO user_cards (id, user_id, deck_id, front, back, example, pronunciation, tags,
                 srs_level, srs_status, srs_next_review, srs_interval, srs_ease, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET front = excluded.front, back = excluded.back,
                 example = excluded.example, pronunciation = excluded.pronunciation, tags = excluded.tags,
                 srs_level = excluded.srs_level, srs_status = excluded.srs_status,
                 srs_next_review = excluded.srs_next_review, srs_interval = excluded.srs_interval,
                 srs_ease = excluded.srs_ease, updated_at = excluded.updated_at
                 WHERE user_cards.user_id = excluded.user_id",
            )
            .bind(&card.id).bind(user_id).bind(&card.deck_id).bind(&card.front).bind(&card.back)
            .bind(&card.example).bind(&card.pronunciation).bind(&card.tags).bind(card.srs_level)
            .bind(&card.srs_status).bind(card.srs_next_review).bind(card.srs_interval)
            .bind(card.srs_ease).bind(card.created_at).bind(card.updated_at)
            .execute(&mut *tx).await?;
        }

        for log in &data.review_logs {
            sqlx::query(
                "INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, time_ms)
                 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(&log.id)
            .bind(user_id)
            .bind(&log.card_id)
            .bind(&log.rating)
            .bind(log.reviewed_at)
            .bind(log.time_ms)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query("UPDATE users SET last_sync_at = ? WHERE id = ?")
            .bind(synced_at)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        Ok(SyncCounts {
            decks: data.decks.len(),
            cards: data.cards.len(),
            logs: data.review_logs.len(),
        })
    }

    async fn download(&self, user_id: &str) -> Result<SyncData, RepositoryError> {
        let decks = sqlx::query_as::<_, DeckRow>(
            "SELECT id, name, description, category, card_count, created_at, updated_at FROM user_decks WHERE user_id = ?",
        ).bind(user_id).fetch_all(&self.pool).await?.into_iter().map(Into::into).collect();
        let cards = sqlx::query_as::<_, CardRow>(
            "SELECT id, deck_id, front, back, example, pronunciation, tags, srs_level, srs_status,
             srs_next_review, srs_interval, srs_ease, created_at, updated_at FROM user_cards WHERE user_id = ?",
        ).bind(user_id).fetch_all(&self.pool).await?.into_iter().map(Into::into).collect();
        let review_logs = sqlx::query_as::<_, ReviewLogRow>(
            "SELECT id, card_id, rating, reviewed_at, time_ms FROM review_logs WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Into::into)
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
        let last_sync_at = sqlx::query_scalar("SELECT last_sync_at FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .flatten();
        let cards_count = count(&self.pool, "user_cards", user_id).await?;
        let decks_count = count(&self.pool, "user_decks", user_id).await?;
        Ok(SyncStatusResponse {
            last_sync_at,
            has_data: cards_count > 0,
            cards_count,
            decks_count,
        })
    }

    async fn stats(&self, user_id: &str) -> Result<UserStats, RepositoryError> {
        Ok(UserStats {
            cards_count: count(&self.pool, "user_cards", user_id).await?,
            decks_count: count(&self.pool, "user_decks", user_id).await?,
            reviews_count: count(&self.pool, "review_logs", user_id).await?,
        })
    }
}

async fn count(pool: &SqlitePool, table: &str, user_id: &str) -> Result<i64, RepositoryError> {
    let query = match table {
        "user_cards" => "SELECT COUNT(*) FROM user_cards WHERE user_id = ?",
        "user_decks" => "SELECT COUNT(*) FROM user_decks WHERE user_id = ?",
        "review_logs" => "SELECT COUNT(*) FROM review_logs WHERE user_id = ?",
        _ => {
            return Err(RepositoryError::Configuration(
                "unsupported count table".to_string(),
            ));
        }
    };
    Ok(sqlx::query_scalar(query)
        .bind(user_id)
        .fetch_one(pool)
        .await?)
}

#[async_trait]
impl HealthRepository for SqliteRepositories {
    async fn is_healthy(&self) -> bool {
        sqlx::query("SELECT 1").fetch_one(&self.pool).await.is_ok()
    }

    fn backend_name(&self) -> &'static str {
        "sqlite"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persists_user_learning_data_and_stats() -> Result<(), RepositoryError> {
        let repository = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repository
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "provider-1",
                name: "First Name",
                email: "first@example.com",
                avatar: None,
            })
            .await?;
        let updated = repository
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "provider-1",
                name: "Updated Name",
                email: "updated@example.com",
                avatar: Some("https://example.com/avatar.png"),
            })
            .await?;
        assert_eq!(updated.id, user.id);
        assert_eq!(updated.name, "Updated Name");

        let now = Utc::now();
        let data = SyncData {
            decks: vec![DeckData {
                id: "deck-1".to_string(),
                name: "Deck".to_string(),
                description: None,
                category: None,
                card_count: 1,
                created_at: now,
                updated_at: now,
            }],
            cards: vec![CardData {
                id: "card-1".to_string(),
                deck_id: "deck-1".to_string(),
                front: "repository".to_string(),
                back: "仓库".to_string(),
                example: None,
                pronunciation: None,
                tags: None,
                srs_level: 0,
                srs_status: "new".to_string(),
                srs_next_review: None,
                srs_interval: 0.0,
                srs_ease: 2.5,
                created_at: now,
                updated_at: now,
            }],
            review_logs: vec![ReviewLogData {
                id: "review-1".to_string(),
                card_id: "card-1".to_string(),
                rating: "good".to_string(),
                reviewed_at: now,
                time_ms: Some(1200),
            }],
            settings: None,
            sync_timestamp: now,
        };

        let counts = repository.upload(&user.id, &data, now).await?;
        assert_eq!(counts.cards, 1);
        assert_eq!(repository.download(&user.id).await?.cards.len(), 1);
        assert_eq!(repository.stats(&user.id).await?.reviews_count, 1);
        assert!(repository.status(&user.id).await?.has_data);
        Ok(())
    }
}
