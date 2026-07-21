use chrono::{DateTime, Duration, Utc};
use serde::{Serialize, de::DeserializeOwned};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
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
    status: String,
    role: String,
    last_login_at: Option<DateTime<Utc>>,
    system_decks_initialized_at: Option<DateTime<Utc>>,
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
            status: row.status,
            role: row.role,
            last_login_at: row.last_login_at,
            system_decks_initialized_at: row.system_decks_initialized_at,
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

#[derive(sqlx::FromRow)]
struct UserSettingsRow {
    theme: Option<String>,
    language: Option<String>,
    speech_provider: Option<String>,
    speech_voice: Option<String>,
    speech_zh_voice: Option<String>,
    speech_model: Option<String>,
    speech_speed: Option<f64>,
    auto_play: Option<bool>,
}

impl From<UserSettingsRow> for UserSettings {
    fn from(row: UserSettingsRow) -> Self {
        Self {
            theme: row.theme,
            language: row.language,
            speech_provider: row.speech_provider,
            speech_voice: row.speech_voice,
            speech_zh_voice: row.speech_zh_voice,
            speech_model: row.speech_model,
            speech_speed: row.speech_speed,
            auto_play: row.auto_play,
        }
    }
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

#[derive(sqlx::FromRow)]
struct VocabDeckRow {
    id: String,
    owner_user_id: String,
    source_key: Option<String>,
    name: String,
    description: String,
    color: Option<String>,
    version: i32,
    sort_order: i32,
    is_active: i64,
    card_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<VocabDeckRow> for Deck {
    fn from(row: VocabDeckRow) -> Self {
        Self {
            id: row.id,
            owner_user_id: row.owner_user_id,
            source_key: row.source_key,
            name: row.name,
            description: row.description,
            color: row.color,
            version: row.version,
            sort_order: row.sort_order,
            is_active: row.is_active != 0,
            card_count: row.card_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct VocabCardRow {
    id: String,
    deck_id: String,
    front: String,
    back: String,
    pronunciation: Option<String>,
    tags: String,
    examples: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<VocabCardRow> for Card {
    type Error = RepositoryError;

    fn try_from(row: VocabCardRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            deck_id: row.deck_id,
            front: row.front,
            back: row.back,
            pronunciation: row.pronunciation,
            tags: parse_json_vec(&row.tags)?,
            examples: parse_json_vec(&row.examples)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(sqlx::FromRow)]
struct CardProgressRow {
    id: String,
    owner_user_id: String,
    card_id: String,
    srs_status: String,
    interval_days: f64,
    repetitions: i32,
    ease_factor: f64,
    due_date: DateTime<Utc>,
    last_reviewed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CardProgressRow> for CardProgress {
    fn from(row: CardProgressRow) -> Self {
        Self {
            id: row.id,
            owner_user_id: row.owner_user_id,
            card_id: row.card_id,
            srs_status: row.srs_status,
            interval: row.interval_days,
            repetitions: row.repetitions,
            ease_factor: row.ease_factor,
            due_date: row.due_date,
            last_reviewed_at: row.last_reviewed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct StudyCardRow {
    id: String,
    deck_id: String,
    front: String,
    back: String,
    pronunciation: Option<String>,
    tags: String,
    examples: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    progress_id: Option<String>,
    progress_owner_user_id: Option<String>,
    progress_card_id: Option<String>,
    progress_srs_status: Option<String>,
    progress_interval_days: Option<f64>,
    progress_repetitions: Option<i32>,
    progress_ease_factor: Option<f64>,
    progress_due_date: Option<DateTime<Utc>>,
    progress_last_reviewed_at: Option<DateTime<Utc>>,
    progress_created_at: Option<DateTime<Utc>>,
    progress_updated_at: Option<DateTime<Utc>>,
}

impl TryFrom<StudyCardRow> for StudyCard {
    type Error = RepositoryError;

    fn try_from(row: StudyCardRow) -> Result<Self, Self::Error> {
        let card = Card {
            id: row.id,
            deck_id: row.deck_id,
            front: row.front,
            back: row.back,
            pronunciation: row.pronunciation,
            tags: parse_json_vec(&row.tags)?,
            examples: parse_json_vec(&row.examples)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        let progress = match (
            row.progress_id,
            row.progress_owner_user_id,
            row.progress_card_id,
            row.progress_srs_status,
            row.progress_interval_days,
            row.progress_repetitions,
            row.progress_ease_factor,
            row.progress_due_date,
            row.progress_created_at,
            row.progress_updated_at,
        ) {
            (
                Some(id),
                Some(owner_user_id),
                Some(card_id),
                Some(srs_status),
                Some(interval),
                Some(repetitions),
                Some(ease_factor),
                Some(due_date),
                Some(created_at),
                Some(updated_at),
            ) => Some(CardProgress {
                id,
                owner_user_id,
                card_id,
                srs_status,
                interval,
                repetitions,
                ease_factor,
                due_date,
                last_reviewed_at: row.progress_last_reviewed_at,
                created_at,
                updated_at,
            }),
            _ => None,
        };
        Ok(StudyCard { card, progress })
    }
}

#[derive(sqlx::FromRow)]
struct ReviewLogV2Row {
    id: String,
    owner_user_id: String,
    card_id: String,
    deck_id: String,
    rating: String,
    time_ms: Option<i32>,
    reviewed_at: DateTime<Utc>,
}

impl From<ReviewLogV2Row> for ReviewLog {
    fn from(row: ReviewLogV2Row) -> Self {
        Self {
            id: row.id,
            owner_user_id: row.owner_user_id,
            card_id: row.card_id,
            deck_id: row.deck_id,
            rating: row.rating,
            time_ms: row.time_ms,
            reviewed_at: row.reviewed_at,
        }
    }
}

fn parse_json_vec<T: DeserializeOwned>(raw: &str) -> Result<Vec<T>, RepositoryError> {
    serde_json::from_str(raw).map_err(|error| RepositoryError::Persistence(error.to_string()))
}

fn to_json_string<T: Serialize>(value: &T) -> Result<String, RepositoryError> {
    serde_json::to_string(value).map_err(|error| RepositoryError::Persistence(error.to_string()))
}

fn new_prefixed_id(prefix: &str) -> String {
    format!("{prefix}{}", Uuid::new_v4().simple())
}

const DECK_SELECT_WITH_COUNT: &str = "SELECT d.id, d.owner_user_id, d.source_key, d.name,
    d.description, d.color, d.version, d.sort_order, d.is_active,
    (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count,
    d.created_at, d.updated_at
 FROM decks d";

const ADMIN_DECK_FILTER: &str = "d.owner_user_id = ?
    AND (? IS NULL OR d.name LIKE ? OR d.description LIKE ? OR d.source_key LIKE ?)";

const ADMIN_CARD_FILTER: &str = "c.deck_id = ?
    AND (? IS NULL OR c.front LIKE ? OR c.back LIKE ? OR c.tags LIKE ?)";

const ADMIN_USER_FILTER: &str = "(? IS NULL OR u.email LIKE ? OR u.name LIKE ? OR u.id LIKE ?)
    AND (? IS NULL OR u.status = ?)
    AND (? IS NULL OR u.role = ?)";

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

    async fn admin_list_users(
        &self,
        q: Option<&str>,
        status: Option<&str>,
        role: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<User>, i64), RepositoryError> {
        let pattern = q.map(|value| format!("%{value}%"));
        let rows = sqlx::query_as::<_, UserRow>(&format!(
            "SELECT u.* FROM users u WHERE {ADMIN_USER_FILTER}
             ORDER BY u.created_at DESC, u.id LIMIT ? OFFSET ?"
        ))
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(status)
        .bind(status)
        .bind(role)
        .bind(role)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM users u WHERE {ADMIN_USER_FILTER}"
        ))
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(status)
        .bind(status)
        .bind(role)
        .bind(role)
        .fetch_one(&self.pool)
        .await?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
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

        sqlx::query("UPDATE users SET status = ?, role = ?, updated_at = ? WHERE id = ?")
            .bind(status)
            .bind(role)
            .bind(Utc::now())
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        self.find_by_id(user_id).await
    }

    async fn admin_user_deck_summaries(
        &self,
        user_id: &str,
    ) -> Result<Vec<(Deck, i64)>, RepositoryError> {
        let rows = sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT} WHERE d.owner_user_id = ? ORDER BY d.created_at, d.id"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let deck: Deck = row.into();
                let card_count = deck.card_count;
                (deck, card_count)
            })
            .collect())
    }

    async fn admin_recent_sync_count(&self, user_id: &str) -> Result<i64, RepositoryError> {
        let since = Utc::now() - Duration::days(30);
        Ok(sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_history WHERE user_id = ? AND created_at >= ?",
        )
        .bind(user_id)
        .bind(since)
        .fetch_one(&self.pool)
        .await?)
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

#[async_trait]
impl SettingsRepository for SqliteRepositories {
    async fn get_settings(&self, user_id: &str) -> Result<UserSettings, RepositoryError> {
        Ok(sqlx::query_as::<_, UserSettingsRow>(
            "SELECT theme, language, speech_provider, speech_voice, speech_zh_voice,
             speech_model, speech_speed, auto_play
             FROM user_settings WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .map(Into::into)
        .unwrap_or_default())
    }

    async fn save_settings(
        &self,
        user_id: &str,
        settings: &UserSettings,
    ) -> Result<UserSettings, RepositoryError> {
        sqlx::query(
            "INSERT INTO user_settings (
                user_id, theme, language, speech_provider, speech_voice, speech_zh_voice,
                speech_model, speech_speed, auto_play, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                theme = excluded.theme,
                language = excluded.language,
                speech_provider = excluded.speech_provider,
                speech_voice = excluded.speech_voice,
                speech_zh_voice = excluded.speech_zh_voice,
                speech_model = excluded.speech_model,
                speech_speed = excluded.speech_speed,
                auto_play = excluded.auto_play,
                updated_at = excluded.updated_at",
        )
        .bind(user_id)
        .bind(&settings.theme)
        .bind(&settings.language)
        .bind(&settings.speech_provider)
        .bind(&settings.speech_voice)
        .bind(&settings.speech_zh_voice)
        .bind(&settings.speech_model)
        .bind(settings.speech_speed)
        .bind(settings.auto_play)
        .bind(Utc::now())
        .execute(&self.pool)
        .await?;

        self.get_settings(user_id).await
    }
}

#[async_trait]
impl VocabularyRepository for SqliteRepositories {
    async fn list_decks_for_user(&self, user_id: &str) -> Result<Vec<Deck>, RepositoryError> {
        let rows = sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT}
             WHERE (d.owner_user_id = ? AND d.is_active = 1) OR d.owner_user_id = ?
             ORDER BY (d.owner_user_id = ?) DESC, d.sort_order, d.name"
        ))
        .bind(SYSTEM_OWNER_ID)
        .bind(user_id)
        .bind(SYSTEM_OWNER_ID)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn get_deck(&self, deck_id: &str) -> Result<Option<Deck>, RepositoryError> {
        Ok(sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT} WHERE d.id = ?"
        ))
        .bind(deck_id)
        .fetch_optional(&self.pool)
        .await?
        .map(Into::into))
    }

    async fn create_user_deck(
        &self,
        user_id: &str,
        req: &CreateDeckRequest,
    ) -> Result<Deck, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("deck_");
        sqlx::query(
            "INSERT INTO decks (
                id, owner_user_id, source_key, name, description, color,
                version, sort_order, is_active, created_at, updated_at
             ) VALUES (?, ?, NULL, ?, ?, ?, 1, 0, 1, ?, ?)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(&req.name)
        .bind(req.description.as_deref().unwrap_or(""))
        .bind(&req.color)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

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

        let result = sqlx::query(
            "UPDATE decks SET name = ?, description = ?, color = ?, updated_at = ?
             WHERE id = ? AND owner_user_id = ?",
        )
        .bind(name)
        .bind(description)
        .bind(color)
        .bind(now)
        .bind(deck_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_deck(deck_id).await
    }

    async fn delete_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<bool, RepositoryError> {
        let result = sqlx::query("DELETE FROM decks WHERE id = ? AND owner_user_id = ?")
            .bind(deck_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_cards(&self, deck_id: &str) -> Result<Vec<Card>, RepositoryError> {
        let rows = sqlx::query_as::<_, VocabCardRow>(
            "SELECT id, deck_id, front, back, pronunciation, tags, examples, created_at, updated_at
             FROM cards WHERE deck_id = ? ORDER BY created_at, id",
        )
        .bind(deck_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn get_card(&self, card_id: &str) -> Result<Option<Card>, RepositoryError> {
        let row = sqlx::query_as::<_, VocabCardRow>(
            "SELECT id, deck_id, front, back, pronunciation, tags, examples, created_at, updated_at
             FROM cards WHERE id = ?",
        )
        .bind(card_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(TryInto::try_into).transpose()
    }

    async fn create_card(
        &self,
        deck_id: &str,
        req: &CreateCardRequest,
        examples: Vec<CardExample>,
    ) -> Result<Card, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("card_");
        let tags = to_json_string(req.tags.as_ref().unwrap_or(&Vec::new()))?;
        let examples_json = to_json_string(&examples)?;

        sqlx::query(
            "INSERT INTO cards (
                id, deck_id, front, back, pronunciation, tags, examples, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(deck_id)
        .bind(&req.front)
        .bind(&req.back)
        .bind(&req.pronunciation)
        .bind(tags)
        .bind(examples_json)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

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
        let tags = to_json_string(req.tags.as_ref().unwrap_or(&existing.tags))?;
        let examples_json = to_json_string(examples.as_ref().unwrap_or(&existing.examples))?;

        let result = sqlx::query(
            "UPDATE cards SET front = ?, back = ?, pronunciation = ?, tags = ?, examples = ?,
             updated_at = ? WHERE id = ?",
        )
        .bind(front)
        .bind(back)
        .bind(pronunciation)
        .bind(tags)
        .bind(examples_json)
        .bind(now)
        .bind(card_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_card(card_id).await
    }

    async fn delete_card(&self, card_id: &str) -> Result<bool, RepositoryError> {
        let result = sqlx::query("DELETE FROM cards WHERE id = ?")
            .bind(card_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_study_cards(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Vec<StudyCard>, RepositoryError> {
        let rows = sqlx::query_as::<_, StudyCardRow>(
            "SELECT c.id, c.deck_id, c.front, c.back, c.pronunciation, c.tags, c.examples,
                    c.created_at, c.updated_at,
                    p.id AS progress_id,
                    p.owner_user_id AS progress_owner_user_id,
                    p.card_id AS progress_card_id,
                    p.srs_status AS progress_srs_status,
                    p.interval_days AS progress_interval_days,
                    p.repetitions AS progress_repetitions,
                    p.ease_factor AS progress_ease_factor,
                    p.due_date AS progress_due_date,
                    p.last_reviewed_at AS progress_last_reviewed_at,
                    p.created_at AS progress_created_at,
                    p.updated_at AS progress_updated_at
             FROM cards c
             LEFT JOIN card_progress p
                ON p.card_id = c.id AND p.owner_user_id = ?
             WHERE c.deck_id = ?
             ORDER BY c.created_at, c.id",
        )
        .bind(user_id)
        .bind(deck_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn upsert_card_progress(
        &self,
        user_id: &str,
        card_id: &str,
        req: &UpsertCardProgressRequest,
    ) -> Result<CardProgress, RepositoryError> {
        let now = Utc::now();
        let id = new_prefixed_id("prog_");
        sqlx::query(
            "INSERT INTO card_progress (
                id, owner_user_id, card_id, srs_status, interval_days, repetitions,
                ease_factor, due_date, last_reviewed_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_user_id, card_id) DO UPDATE SET
                srs_status = excluded.srs_status,
                interval_days = excluded.interval_days,
                repetitions = excluded.repetitions,
                ease_factor = excluded.ease_factor,
                due_date = excluded.due_date,
                last_reviewed_at = excluded.last_reviewed_at,
                updated_at = excluded.updated_at",
        )
        .bind(&id)
        .bind(user_id)
        .bind(card_id)
        .bind(&req.srs_status)
        .bind(req.interval)
        .bind(req.repetitions)
        .bind(req.ease_factor)
        .bind(req.due_date)
        .bind(req.last_reviewed_at)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(sqlx::query_as::<_, CardProgressRow>(
            "SELECT id, owner_user_id, card_id, srs_status, interval_days, repetitions,
                    ease_factor, due_date, last_reviewed_at, created_at, updated_at
             FROM card_progress WHERE owner_user_id = ? AND card_id = ?",
        )
        .bind(user_id)
        .bind(card_id)
        .fetch_one(&self.pool)
        .await?
        .into())
    }

    async fn create_review_log(
        &self,
        user_id: &str,
        req: &CreateReviewLogRequest,
    ) -> Result<ReviewLog, RepositoryError> {
        let id = new_prefixed_id("rev_");
        let reviewed_at = req.reviewed_at.unwrap_or_else(Utc::now);
        sqlx::query(
            "INSERT INTO review_logs_v2 (
                id, owner_user_id, card_id, deck_id, rating, time_ms, reviewed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(&req.card_id)
        .bind(&req.deck_id)
        .bind(&req.rating)
        .bind(req.time_ms)
        .bind(reviewed_at)
        .execute(&self.pool)
        .await?;

        Ok(sqlx::query_as::<_, ReviewLogV2Row>(
            "SELECT id, owner_user_id, card_id, deck_id, rating, time_ms, reviewed_at
             FROM review_logs_v2 WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&self.pool)
        .await?
        .into())
    }

    async fn count_system_decks(&self) -> Result<i64, RepositoryError> {
        Ok(sqlx::query_scalar("SELECT COUNT(*) FROM decks WHERE owner_user_id = ?")
            .bind(SYSTEM_OWNER_ID)
            .fetch_one(&self.pool)
            .await?)
    }

    async fn insert_system_deck(&self, deck: &Deck) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO decks (
                id, owner_user_id, source_key, name, description, color,
                version, sort_order, is_active, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&deck.id)
        .bind(&deck.owner_user_id)
        .bind(&deck.source_key)
        .bind(&deck.name)
        .bind(&deck.description)
        .bind(&deck.color)
        .bind(deck.version)
        .bind(deck.sort_order)
        .bind(if deck.is_active { 1 } else { 0 })
        .bind(deck.created_at)
        .bind(deck.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn insert_system_card(&self, card: &Card) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO cards (
                id, deck_id, front, back, pronunciation, tags, examples, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&card.id)
        .bind(&card.deck_id)
        .bind(&card.front)
        .bind(&card.back)
        .bind(&card.pronunciation)
        .bind(to_json_string(&card.tags)?)
        .bind(to_json_string(&card.examples)?)
        .bind(card.created_at)
        .bind(card.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_system_decks_initialized(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE users SET system_decks_initialized_at = ? WHERE id = ?")
            .bind(at)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_system_decks_initialized_at(
        &self,
        user_id: &str,
    ) -> Result<Option<DateTime<Utc>>, RepositoryError> {
        Ok(
            sqlx::query_scalar("SELECT system_decks_initialized_at FROM users WHERE id = ?")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?
                .flatten(),
        )
    }

    async fn touch_last_login(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE users SET last_login_at = ? WHERE id = ?")
            .bind(at)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn admin_list_system_decks(
        &self,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Deck>, i64), RepositoryError> {
        let pattern = q.map(|value| format!("%{value}%"));
        let rows = sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT} WHERE {ADMIN_DECK_FILTER}
             ORDER BY d.sort_order, d.name LIMIT ? OFFSET ?"
        ))
        .bind(SYSTEM_OWNER_ID)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM decks d WHERE {ADMIN_DECK_FILTER}"
        ))
        .bind(SYSTEM_OWNER_ID)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .fetch_one(&self.pool)
        .await?;

        Ok((rows.into_iter().map(Into::into).collect(), total))
    }

    async fn admin_list_cards(
        &self,
        deck_id: &str,
        q: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<(Vec<Card>, i64), RepositoryError> {
        let pattern = q.map(|value| format!("%{value}%"));
        let rows = sqlx::query_as::<_, VocabCardRow>(&format!(
            "SELECT c.id, c.deck_id, c.front, c.back, c.pronunciation, c.tags, c.examples,
                    c.created_at, c.updated_at
             FROM cards c WHERE {ADMIN_CARD_FILTER}
             ORDER BY c.created_at, c.id LIMIT ? OFFSET ?"
        ))
        .bind(deck_id)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let total: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM cards c WHERE {ADMIN_CARD_FILTER}"
        ))
        .bind(deck_id)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .fetch_one(&self.pool)
        .await?;

        let cards = rows
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<Card>, RepositoryError>>()?;
        Ok((cards, total))
    }

    async fn admin_find_system_deck_by_source_key(
        &self,
        source_key: &str,
    ) -> Result<Option<Deck>, RepositoryError> {
        Ok(sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT} WHERE d.owner_user_id = ? AND d.source_key = ?"
        ))
        .bind(SYSTEM_OWNER_ID)
        .bind(source_key)
        .fetch_optional(&self.pool)
        .await?
        .map(Into::into))
    }

    async fn admin_find_system_deck_by_name(
        &self,
        name: &str,
    ) -> Result<Option<Deck>, RepositoryError> {
        Ok(sqlx::query_as::<_, VocabDeckRow>(&format!(
            "{DECK_SELECT_WITH_COUNT} WHERE d.owner_user_id = ? AND d.name = ?"
        ))
        .bind(SYSTEM_OWNER_ID)
        .bind(name)
        .fetch_optional(&self.pool)
        .await?
        .map(Into::into))
    }

    async fn admin_upsert_system_deck(&self, deck: &Deck) -> Result<Deck, RepositoryError> {
        sqlx::query(
            "INSERT INTO decks (
                id, owner_user_id, source_key, name, description, color,
                version, sort_order, is_active, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                source_key = excluded.source_key,
                name = excluded.name,
                description = excluded.description,
                color = excluded.color,
                version = excluded.version,
                sort_order = excluded.sort_order,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at",
        )
        .bind(&deck.id)
        .bind(&deck.owner_user_id)
        .bind(&deck.source_key)
        .bind(&deck.name)
        .bind(&deck.description)
        .bind(&deck.color)
        .bind(deck.version)
        .bind(deck.sort_order)
        .bind(if deck.is_active { 1 } else { 0 })
        .bind(deck.created_at)
        .bind(deck.updated_at)
        .execute(&self.pool)
        .await?;

        self.get_deck(&deck.id)
            .await?
            .ok_or_else(|| RepositoryError::Persistence("upserted deck missing".to_string()))
    }

    async fn admin_delete_cards_in_deck(&self, deck_id: &str) -> Result<u64, RepositoryError> {
        let result = sqlx::query("DELETE FROM cards WHERE deck_id = ?")
            .bind(deck_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    async fn admin_delete_system_deck(&self, deck_id: &str) -> Result<bool, RepositoryError> {
        let result = sqlx::query("DELETE FROM decks WHERE id = ? AND owner_user_id = ?")
            .bind(deck_id)
            .bind(SYSTEM_OWNER_ID)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn admin_find_card_by_front(
        &self,
        deck_id: &str,
        front: &str,
    ) -> Result<Option<Card>, RepositoryError> {
        let row = sqlx::query_as::<_, VocabCardRow>(
            "SELECT id, deck_id, front, back, pronunciation, tags, examples, created_at, updated_at
             FROM cards WHERE deck_id = ? AND front = ?",
        )
        .bind(deck_id)
        .bind(front)
        .fetch_optional(&self.pool)
        .await?;
        row.map(TryInto::try_into).transpose()
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

    #[tokio::test]
    async fn persists_settings_per_user() -> Result<(), RepositoryError> {
        let repository = SqliteRepositories::connect("sqlite::memory:").await?;
        let first_user = repository
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "provider-settings-1",
                name: "Settings One",
                email: "settings-one@example.com",
                avatar: None,
            })
            .await?;
        let second_user = repository
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "provider-settings-2",
                name: "Settings Two",
                email: "settings-two@example.com",
                avatar: None,
            })
            .await?;

        let saved = repository
            .save_settings(
                &first_user.id,
                &UserSettings {
                    theme: Some("zhuqing".to_string()),
                    language: Some("en".to_string()),
                    speech_provider: Some("google".to_string()),
                    speech_voice: Some("en-US-Neural2-F".to_string()),
                    speech_zh_voice: Some("cmn-CN-Neural2-A".to_string()),
                    speech_model: Some("neural2".to_string()),
                    speech_speed: Some(1.1),
                    auto_play: Some(true),
                },
            )
            .await?;

        assert_eq!(saved.theme.as_deref(), Some("zhuqing"));
        assert_eq!(
            repository.get_settings(&first_user.id).await?.speech_provider,
            Some("google".to_string())
        );
        assert_eq!(repository.get_settings(&second_user.id).await?, UserSettings::default());

        Ok(())
    }

    #[tokio::test]
    async fn system_and_user_decks_are_listed_together() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "vocab-decks-1",
                name: "Vocab User",
                email: "vocab-decks@example.com",
                avatar: None,
            })
            .await?;

        let now = Utc::now();
        repo.insert_system_deck(&Deck {
            id: "deck_system_a".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("core".to_string()),
            name: "System Deck".to_string(),
            description: "shared".to_string(),
            color: None,
            version: 1,
            sort_order: 1,
            is_active: true,
            card_count: 0,
            created_at: now,
            updated_at: now,
        })
        .await?;
        repo.insert_system_deck(&Deck {
            id: "deck_system_inactive".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("legacy".to_string()),
            name: "Inactive System".to_string(),
            description: "".to_string(),
            color: None,
            version: 1,
            sort_order: 99,
            is_active: false,
            card_count: 0,
            created_at: now,
            updated_at: now,
        })
        .await?;

        let user_deck = repo
            .create_user_deck(
                &user.id,
                &CreateDeckRequest {
                    name: "My Deck".to_string(),
                    description: Some("personal".to_string()),
                    color: Some("#112233".to_string()),
                },
            )
            .await?;

        let decks = repo.list_decks_for_user(&user.id).await?;
        assert_eq!(decks.len(), 2);
        assert_eq!(decks[0].id, "deck_system_a");
        assert_eq!(decks[0].owner_user_id, SYSTEM_OWNER_ID);
        assert_eq!(decks[1].id, user_deck.id);
        assert_eq!(decks[1].owner_user_id, user.id);
        assert_eq!(decks[1].card_count, 0);

        Ok(())
    }

    #[tokio::test]
    async fn card_progress_is_isolated_per_user() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let first = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "vocab-progress-1",
                name: "Progress One",
                email: "progress-one@example.com",
                avatar: None,
            })
            .await?;
        let second = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "vocab-progress-2",
                name: "Progress Two",
                email: "progress-two@example.com",
                avatar: None,
            })
            .await?;

        let deck = repo
            .create_user_deck(
                &first.id,
                &CreateDeckRequest {
                    name: "Shared Content Deck".to_string(),
                    description: None,
                    color: None,
                },
            )
            .await?;
        let card = repo
            .create_card(
                &deck.id,
                &CreateCardRequest {
                    front: "hello".to_string(),
                    back: "你好".to_string(),
                    pronunciation: None,
                    tags: None,
                    examples: None,
                },
                vec![],
            )
            .await?;

        let due = Utc::now();
        repo.upsert_card_progress(
            &first.id,
            &card.id,
            &UpsertCardProgressRequest {
                srs_status: "learning".to_string(),
                interval: 1.0,
                repetitions: 1,
                ease_factor: 2.5,
                due_date: due,
                last_reviewed_at: Some(due),
            },
        )
        .await?;
        repo.upsert_card_progress(
            &second.id,
            &card.id,
            &UpsertCardProgressRequest {
                srs_status: "review".to_string(),
                interval: 7.0,
                repetitions: 3,
                ease_factor: 2.6,
                due_date: due,
                last_reviewed_at: None,
            },
        )
        .await?;

        let first_study = repo.list_study_cards(&first.id, &deck.id).await?;
        let second_study = repo.list_study_cards(&second.id, &deck.id).await?;
        assert_eq!(first_study.len(), 1);
        assert_eq!(second_study.len(), 1);
        assert_eq!(
            first_study[0].progress.as_ref().map(|p| p.srs_status.as_str()),
            Some("learning")
        );
        assert_eq!(first_study[0].progress.as_ref().map(|p| p.interval), Some(1.0));
        assert_eq!(
            second_study[0].progress.as_ref().map(|p| p.srs_status.as_str()),
            Some("review")
        );
        assert_eq!(second_study[0].progress.as_ref().map(|p| p.interval), Some(7.0));
        assert_ne!(
            first_study[0].progress.as_ref().map(|p| p.id.as_str()),
            second_study[0].progress.as_ref().map(|p| p.id.as_str())
        );

        Ok(())
    }

    #[tokio::test]
    async fn tags_and_examples_round_trip_as_json_arrays() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "vocab-json-1",
                name: "Json User",
                email: "vocab-json@example.com",
                avatar: None,
            })
            .await?;
        let deck = repo
            .create_user_deck(
                &user.id,
                &CreateDeckRequest {
                    name: "JSON Deck".to_string(),
                    description: None,
                    color: None,
                },
            )
            .await?;

        let examples = vec![CardExample {
            id: "ex_1".to_string(),
            sentence_en: "Hello world".to_string(),
            translation_zh: "你好世界".to_string(),
        }];
        let created = repo
            .create_card(
                &deck.id,
                &CreateCardRequest {
                    front: "world".to_string(),
                    back: "世界".to_string(),
                    pronunciation: Some("/wɜːrld/".to_string()),
                    tags: Some(vec!["noun".to_string(), "basic".to_string()]),
                    examples: None,
                },
                examples.clone(),
            )
            .await?;

        let fetched = repo
            .get_card(&created.id)
            .await?
            .expect("card should exist");
        assert_eq!(fetched.tags, vec!["noun".to_string(), "basic".to_string()]);
        assert_eq!(fetched.examples, examples);
        assert_eq!(fetched.examples[0].sentence_en, "Hello world");

        let listed = repo.list_cards(&deck.id).await?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].tags.len(), 2);
        assert_eq!(listed[0].examples.len(), 1);

        Ok(())
    }

    #[tokio::test]
    async fn admin_list_system_decks_filters_by_q() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "admin-decks-1",
                name: "Admin Decks User",
                email: "admin-decks@example.com",
                avatar: None,
            })
            .await?;

        let now = Utc::now();
        repo.insert_system_deck(&Deck {
            id: "deck_admin_a".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("core-vocab".to_string()),
            name: "Core Vocabulary".to_string(),
            description: "Everyday words".to_string(),
            color: None,
            version: 1,
            sort_order: 1,
            is_active: true,
            card_count: 0,
            created_at: now,
            updated_at: now,
        })
        .await?;
        repo.insert_system_deck(&Deck {
            id: "deck_admin_b".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("business".to_string()),
            name: "Business English".to_string(),
            description: "Work related terms".to_string(),
            color: None,
            version: 1,
            sort_order: 2,
            is_active: true,
            card_count: 0,
            created_at: now,
            updated_at: now,
        })
        .await?;
        // A user-owned deck matching the query text must never leak into system results.
        repo.create_user_deck(
            &user.id,
            &CreateDeckRequest {
                name: "My Core List".to_string(),
                description: None,
                color: None,
            },
        )
        .await?;

        let (all, total_all) = repo.admin_list_system_decks(None, 0, 10).await?;
        assert_eq!(total_all, 2);
        assert_eq!(all.len(), 2);

        let (filtered, total_filtered) = repo.admin_list_system_decks(Some("core"), 0, 10).await?;
        assert_eq!(total_filtered, 1);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "deck_admin_a");

        let (paged, total_paged) = repo.admin_list_system_decks(None, 1, 1).await?;
        assert_eq!(total_paged, 2);
        assert_eq!(paged.len(), 1);
        assert_eq!(paged[0].id, "deck_admin_b");

        Ok(())
    }

    #[tokio::test]
    async fn admin_list_users_paginates() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        for index in 0..3 {
            repo.find_or_create(UserIdentity {
                provider: "test",
                provider_id: &format!("admin-users-{index}"),
                name: &format!("Admin User {index}"),
                email: &format!("admin-user-{index}@example.com"),
                avatar: None,
            })
            .await?;
        }

        let (first_page, total) = repo.admin_list_users(None, None, None, 0, 2).await?;
        assert_eq!(total, 3);
        assert_eq!(first_page.len(), 2);

        let (second_page, total) = repo.admin_list_users(None, None, None, 2, 2).await?;
        assert_eq!(total, 3);
        assert_eq!(second_page.len(), 1);

        let (filtered, filtered_total) = repo
            .admin_list_users(Some("admin-user-1"), None, None, 0, 10)
            .await?;
        assert_eq!(filtered_total, 1);
        assert_eq!(filtered[0].email, "admin-user-1@example.com");

        Ok(())
    }

    #[tokio::test]
    async fn admin_update_user_status_and_role() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "admin-update-1",
                name: "Update Me",
                email: "admin-update@example.com",
                avatar: None,
            })
            .await?;
        assert_eq!(user.status, "active");
        assert_eq!(user.role, "user");

        let updated = repo
            .admin_update_user(&user.id, Some("disabled"), Some("admin"))
            .await?
            .expect("user should exist");
        assert_eq!(updated.status, "disabled");
        assert_eq!(updated.role, "admin");

        let role_only = repo
            .admin_update_user(&user.id, None, Some("user"))
            .await?
            .expect("user should exist");
        assert_eq!(role_only.status, "disabled");
        assert_eq!(role_only.role, "user");

        let missing = repo
            .admin_update_user("nonexistent", Some("active"), None)
            .await?;
        assert!(missing.is_none());

        Ok(())
    }

    #[tokio::test]
    async fn admin_system_deck_and_card_helpers_round_trip() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let now = Utc::now();
        let deck = Deck {
            id: "deck_admin_helper".to_string(),
            owner_user_id: SYSTEM_OWNER_ID.to_string(),
            source_key: Some("helper-key".to_string()),
            name: "Helper Deck".to_string(),
            description: "For helper tests".to_string(),
            color: None,
            version: 1,
            sort_order: 0,
            is_active: true,
            card_count: 0,
            created_at: now,
            updated_at: now,
        };
        let upserted = repo.admin_upsert_system_deck(&deck).await?;
        assert_eq!(upserted.id, deck.id);

        let by_source_key = repo
            .admin_find_system_deck_by_source_key("helper-key")
            .await?
            .expect("deck should be found by source_key");
        assert_eq!(by_source_key.id, deck.id);

        let by_name = repo
            .admin_find_system_deck_by_name("Helper Deck")
            .await?
            .expect("deck should be found by name");
        assert_eq!(by_name.id, deck.id);

        let mut renamed = deck.clone();
        renamed.name = "Helper Deck Renamed".to_string();
        let upserted_again = repo.admin_upsert_system_deck(&renamed).await?;
        assert_eq!(upserted_again.name, "Helper Deck Renamed");
        assert!(
            repo.admin_find_system_deck_by_name("Helper Deck")
                .await?
                .is_none()
        );

        repo.insert_system_card(&Card {
            id: "card_admin_helper".to_string(),
            deck_id: deck.id.clone(),
            front: "hello".to_string(),
            back: "你好".to_string(),
            pronunciation: None,
            tags: vec![],
            examples: vec![],
            created_at: now,
            updated_at: now,
        })
        .await?;

        let found_card = repo
            .admin_find_card_by_front(&deck.id, "hello")
            .await?
            .expect("card should be found by front");
        assert_eq!(found_card.id, "card_admin_helper");

        let (cards, total) = repo.admin_list_cards(&deck.id, None, 0, 10).await?;
        assert_eq!(total, 1);
        assert_eq!(cards.len(), 1);

        let (filtered_cards, filtered_total) = repo
            .admin_list_cards(&deck.id, Some("nomatch"), 0, 10)
            .await?;
        assert_eq!(filtered_total, 0);
        assert!(filtered_cards.is_empty());

        let deleted = repo.admin_delete_cards_in_deck(&deck.id).await?;
        assert_eq!(deleted, 1);
        assert!(
            repo.admin_find_card_by_front(&deck.id, "hello")
                .await?
                .is_none()
        );

        Ok(())
    }

    #[tokio::test]
    async fn admin_user_deck_summaries_and_recent_sync_count() -> Result<(), RepositoryError> {
        let repo = SqliteRepositories::connect("sqlite::memory:").await?;
        let user = repo
            .find_or_create(UserIdentity {
                provider: "test",
                provider_id: "admin-summary-1",
                name: "Summary User",
                email: "admin-summary@example.com",
                avatar: None,
            })
            .await?;

        let empty = repo.admin_user_deck_summaries(&user.id).await?;
        assert!(empty.is_empty());

        let deck = repo
            .create_user_deck(
                &user.id,
                &CreateDeckRequest {
                    name: "Summary Deck".to_string(),
                    description: None,
                    color: None,
                },
            )
            .await?;
        repo.create_card(
            &deck.id,
            &CreateCardRequest {
                front: "word".to_string(),
                back: "词".to_string(),
                pronunciation: None,
                tags: None,
                examples: None,
            },
            vec![],
        )
        .await?;

        let summaries = repo.admin_user_deck_summaries(&user.id).await?;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].0.id, deck.id);
        assert_eq!(summaries[0].1, 1);

        let recent_sync_count = repo.admin_recent_sync_count(&user.id).await?;
        assert_eq!(recent_sync_count, 0);

        Ok(())
    }
}
