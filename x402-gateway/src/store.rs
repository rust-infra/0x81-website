use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("not found")]
    NotFound,
    #[error("duplicate payment nonce")]
    DuplicateNonce,
    #[error("payer already has an in-flight payment")]
    PayerBusy,
    #[error("illegal payment state transition")]
    IllegalTransition,
    #[error("invalid database URL; phase 0 accepts sqlite:")]
    InvalidDatabaseUrl,
    #[error("database directory {0} does not exist")]
    MissingDirectory(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PriceRule {
    pub model: String,
    pub price_atomic: i64,
    pub max_output_tokens: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PaymentAttempt {
    pub request_id: String,
    pub payer: String,
    pub network: String,
    pub asset: String,
    pub nonce: String,
    pub amount_atomic: i64,
    pub pay_to: String,
    pub status: String,
    pub payload_hash: String,
    pub valid_before: DateTime<Utc>,
    pub tx_hash: Option<String>,
    pub invalid_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
    pub settled_at: Option<DateTime<Utc>>,
    pub served_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageEvent {
    pub request_id: String,
    pub model: String,
    pub price_atomic: i64,
    pub status: String,
    pub latency_ms: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub async fn connect(database_url: &str) -> Result<Self, StoreError> {
        let normalized = normalize_database_url(database_url)?;
        let options = SqliteConnectOptions::from_str(&normalized)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn ping(&self) -> Result<(), StoreError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn schema_version(&self) -> Result<i64, StoreError> {
        let version =
            sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
                .fetch_one(&self.pool)
                .await;
        match version {
            Ok(version) => Ok(version),
            Err(_) => Ok(0),
        }
    }

    pub async fn prices(&self) -> Result<Vec<PriceRule>, StoreError> {
        Ok(sqlx::query_as::<_, PriceRule>(
            "SELECT model, price_atomic, max_output_tokens, active
             FROM price_rules WHERE active = 1 ORDER BY model",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn price_for(&self, model: &str) -> Result<PriceRule, StoreError> {
        sqlx::query_as::<_, PriceRule>(
            "SELECT model, price_atomic, max_output_tokens, active
             FROM price_rules WHERE model = ? AND active = 1",
        )
        .bind(model)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::NotFound)
    }

    pub async fn upsert_price(&self, rule: &PriceRule) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO price_rules (model, price_atomic, max_output_tokens, active, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(model) DO UPDATE SET
               price_atomic = excluded.price_atomic,
               max_output_tokens = excluded.max_output_tokens,
               active = excluded.active",
        )
        .bind(&rule.model)
        .bind(rule.price_atomic)
        .bind(rule.max_output_tokens)
        .bind(rule.active)
        .bind(Utc::now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn nonce_exists(
        &self,
        network: &str,
        asset: &str,
        payer: &str,
        nonce: &str,
    ) -> Result<bool, StoreError> {
        let found = sqlx::query_scalar::<_, i64>(
            "SELECT 1 FROM payment_attempts
             WHERE network = ? AND asset = ? AND payer = ? AND nonce = ?",
        )
        .bind(network)
        .bind(asset)
        .bind(payer)
        .bind(nonce)
        .fetch_optional(&self.pool)
        .await?;
        Ok(found.is_some())
    }

    pub async fn insert_attempt(&self, attempt: &PaymentAttempt) -> Result<(), StoreError> {
        let result = sqlx::query(
            "INSERT INTO payment_attempts
               (request_id, payer, network, asset, nonce, amount_atomic, pay_to,
                status, payload_hash, valid_before, tx_hash, invalid_reason,
                created_at, verified_at, settled_at, served_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&attempt.request_id)
        .bind(&attempt.payer)
        .bind(&attempt.network)
        .bind(&attempt.asset)
        .bind(&attempt.nonce)
        .bind(attempt.amount_atomic)
        .bind(&attempt.pay_to)
        .bind(&attempt.status)
        .bind(&attempt.payload_hash)
        .bind(attempt.valid_before)
        .bind(&attempt.tx_hash)
        .bind(&attempt.invalid_reason)
        .bind(attempt.created_at)
        .bind(attempt.verified_at)
        .bind(attempt.settled_at)
        .bind(attempt.served_at)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
                if self
                    .nonce_exists(
                        &attempt.network,
                        &attempt.asset,
                        &attempt.payer,
                        &attempt.nonce,
                    )
                    .await?
                {
                    Err(StoreError::DuplicateNonce)
                } else {
                    Err(StoreError::PayerBusy)
                }
            }
            Err(err) => Err(StoreError::Sqlx(err)),
        }
    }

    pub async fn mark_settling(&self, request_id: &str) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE payment_attempts SET status = 'settling'
             WHERE request_id = ? AND status = 'verified'",
        )
        .bind(request_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StoreError::IllegalTransition);
        }
        Ok(())
    }

    pub async fn mark_settled(&self, request_id: &str, tx_hash: &str) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE payment_attempts
             SET status = 'settled', tx_hash = ?, settled_at = ?
             WHERE request_id = ? AND status = 'settling'",
        )
        .bind(tx_hash)
        .bind(Utc::now())
        .bind(request_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StoreError::IllegalTransition);
        }
        Ok(())
    }

    pub async fn mark_settle_failed(
        &self,
        request_id: &str,
        reason: &str,
    ) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE payment_attempts
             SET status = 'settle_failed', invalid_reason = ?
             WHERE request_id = ? AND status IN ('verified', 'settling')",
        )
        .bind(reason)
        .bind(request_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StoreError::IllegalTransition);
        }
        Ok(())
    }

    pub async fn mark_served(&self, request_id: &str) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE payment_attempts
             SET status = 'served', served_at = ?
             WHERE request_id = ? AND status = 'settled'",
        )
        .bind(Utc::now())
        .bind(request_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StoreError::IllegalTransition);
        }
        Ok(())
    }

    pub async fn record_usage(&self, event: &UsageEvent) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT OR IGNORE INTO usage_events
               (request_id, model, price_atomic, status, latency_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.request_id)
        .bind(&event.model)
        .bind(event.price_atomic)
        .bind(&event.status)
        .bind(event.latency_ms)
        .bind(event.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_attempt(&self, request_id: &str) -> Result<PaymentAttempt, StoreError> {
        sqlx::query_as::<_, PaymentAttempt>(
            "SELECT request_id, payer, network, asset, nonce, amount_atomic, pay_to,
                    status, payload_hash, valid_before, tx_hash, invalid_reason,
                    created_at, verified_at, settled_at, served_at
             FROM payment_attempts WHERE request_id = ?",
        )
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(StoreError::NotFound)
    }

    /// Closes rows left in flight by a previous process. Expired or failed rows
    /// and settled-but-not-served rows leave the in-flight index, so the payer
    /// can start a new request.
    pub async fn reconcile_stale(&self, now: DateTime<Utc>) -> Result<(u64, u64), StoreError> {
        let expired = sqlx::query(
            "UPDATE payment_attempts
             SET status = CASE WHEN julianday(valid_before) < julianday(?) THEN 'expired'
                               ELSE 'settle_failed' END,
                 invalid_reason = CASE WHEN julianday(valid_before) < julianday(?) THEN 'expired_at_startup'
                                       ELSE 'startup_reconcile_unsettled' END
             WHERE status IN ('verified', 'settling')",
        )
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?
        .rows_affected();

        let orphaned = sqlx::query(
            "UPDATE payment_attempts
             SET status = 'orphaned', invalid_reason = 'settled_not_served_at_startup'
             WHERE status = 'settled'",
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        Ok((expired, orphaned))
    }
}

fn normalize_database_url(raw: &str) -> Result<String, StoreError> {
    if raw == "sqlite::memory:" {
        return Ok(raw.to_string());
    }

    let rest = raw
        .strip_prefix("sqlite://")
        .or_else(|| raw.strip_prefix("sqlite:"))
        .ok_or(StoreError::InvalidDatabaseUrl)?;
    let path = rest.split('?').next().unwrap_or(rest);
    if path.is_empty() {
        return Err(StoreError::InvalidDatabaseUrl);
    }

    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(StoreError::MissingDirectory(parent.display().to_string()));
        }
    }

    Ok(format!("sqlite://{rest}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration as ChronoDuration;
    use std::sync::Arc;

    async fn open_store() -> (Store, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.db");
        let store = Store::connect(&format!("sqlite:{}", path.display()))
            .await
            .unwrap();
        sqlx::migrate!("./migrations")
            .run(store.pool())
            .await
            .unwrap();
        (store, dir)
    }

    fn attempt(request_id: &str, payer: &str, nonce: &str) -> PaymentAttempt {
        let now = Utc::now();
        PaymentAttempt {
            request_id: request_id.to_string(),
            payer: payer.to_string(),
            network: "base-sepolia".to_string(),
            asset: "0x2222222222222222222222222222222222222222".to_string(),
            nonce: nonce.to_string(),
            amount_atomic: 1000,
            pay_to: "0x1111111111111111111111111111111111111111".to_string(),
            status: "verified".to_string(),
            payload_hash: "hash".to_string(),
            valid_before: now + ChronoDuration::hours(1),
            tx_hash: None,
            invalid_reason: None,
            created_at: now,
            verified_at: Some(now),
            settled_at: None,
            served_at: None,
        }
    }

    #[tokio::test]
    async fn schema_and_seed() {
        let (store, _dir) = open_store().await;
        assert_eq!(store.schema_version().await.unwrap(), 1);
        let rule = store.price_for("echo").await.unwrap();
        assert_eq!(rule.price_atomic, 1000);
    }

    #[tokio::test]
    async fn duplicate_nonce_is_rejected() {
        let (store, _dir) = open_store().await;
        store
            .insert_attempt(&attempt("req_1", "0xpayer", "0xnonce"))
            .await
            .unwrap();
        let err = store
            .insert_attempt(&attempt("req_2", "0xpayer", "0xnonce"))
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::DuplicateNonce));
    }

    #[tokio::test]
    async fn payer_busy_is_rejected() {
        let (store, _dir) = open_store().await;
        store
            .insert_attempt(&attempt("req_1", "0xpayer", "0xnonce1"))
            .await
            .unwrap();
        let err = store
            .insert_attempt(&attempt("req_2", "0xpayer", "0xnonce2"))
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::PayerBusy));
    }

    #[tokio::test]
    async fn state_transitions() {
        let (store, _dir) = open_store().await;
        store
            .insert_attempt(&attempt("req_1", "0xpayer", "0xnonce"))
            .await
            .unwrap();
        store.mark_settling("req_1").await.unwrap();
        store.mark_settled("req_1", "0xtx").await.unwrap();
        store.mark_served("req_1").await.unwrap();

        let got = store.get_attempt("req_1").await.unwrap();
        assert_eq!(got.status, "served");
        assert_eq!(got.tx_hash.as_deref(), Some("0xtx"));
        assert!(matches!(
            store.mark_served("req_1").await.unwrap_err(),
            StoreError::IllegalTransition
        ));
    }

    #[tokio::test]
    async fn reconcile_stale_rows() {
        let (store, _dir) = open_store().await;

        let mut expired = attempt("req_expired", "0xpayer1", "0xnonce1");
        expired.valid_before = Utc::now() - ChronoDuration::hours(1);
        store.insert_attempt(&expired).await.unwrap();

        store
            .insert_attempt(&attempt("req_pending", "0xpayer2", "0xnonce2"))
            .await
            .unwrap();

        store
            .insert_attempt(&attempt("req_orphan", "0xpayer3", "0xnonce3"))
            .await
            .unwrap();
        store.mark_settling("req_orphan").await.unwrap();
        store.mark_settled("req_orphan", "0xtx").await.unwrap();

        let (expired_count, orphaned_count) = store.reconcile_stale(Utc::now()).await.unwrap();
        assert_eq!(expired_count, 2);
        assert_eq!(orphaned_count, 1);
        assert_eq!(
            store.get_attempt("req_expired").await.unwrap().status,
            "expired"
        );
        assert_eq!(
            store.get_attempt("req_pending").await.unwrap().status,
            "settle_failed"
        );
        assert_eq!(
            store.get_attempt("req_orphan").await.unwrap().status,
            "orphaned"
        );
    }

    #[tokio::test]
    async fn concurrent_payer_inserts_have_one_winner() {
        let (store, _dir) = open_store().await;
        let store = Arc::new(store);
        let mut handles = Vec::new();
        for i in 0..8 {
            let store = store.clone();
            handles.push(tokio::spawn(async move {
                store
                    .insert_attempt(&attempt(
                        &format!("req_{i}"),
                        "0xpayer",
                        &format!("0xnonce_{i}"),
                    ))
                    .await
            }));
        }

        let mut ok = 0;
        let mut busy = 0;
        for handle in handles {
            match handle.await.unwrap() {
                Ok(()) => ok += 1,
                Err(StoreError::PayerBusy) => busy += 1,
                Err(err) => panic!("unexpected error: {err}"),
            }
        }
        assert_eq!(ok, 1);
        assert_eq!(busy, 7);
    }
}
