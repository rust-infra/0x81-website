# 打字训练进度与掌握度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让打字训练进度真实可持久化：登录态下同步到后端，打字成绩影响单词掌握度排序并联动 SRS。

**Architecture:** 后端新增 `type_entries` / `type_sessions` 两张 SQLite 表与 `TypeRepository` trait（Mongo 按 collect_jobs 惯例给 stub），`TypeService` 负责校验/幂等写入/聚合，`routes/type.rs` 提供 JWT 保护的 `/api/type/sync` 与 `/api/type/stats`。前端把打字会话收集逻辑抽成纯函数模块（可测试），`TypeTraining.tsx` 在会话结束（练完/退出）时批量同步并排序，`Stats.tsx` 展示打字统计区块。

**Tech Stack:** Rust + Axum + SQLx(SQLite) / React 19 + TypeScript + Vite + Vitest + Dexie。

## Global Constraints

- 接口字段一律 snake_case（与现有 `/api/*` 一致）；前端类型定义同样 snake_case。
- 离谱判定：跳过/放弃，或该词正确率 < 0.70（手误不算）；正确率 0.70 恰好不算离谱。
- 幂等：`type_sessions` / `type_entries` 以 id 为主键，重复上传 `ON CONFLICT(id) DO NOTHING`。
- 校验：`mode` ∈ {word, sentence}；`accuracy` ∈ [0,1]；`entries` 单请求 ≤ 2000 条；计数/时长非负。
- 掌握分公式：`score = clamp(round(accuracy*100 - egregious_count*15), 0, 100)`，低分优先出题。
- 本地模式/未登录：不记录统计、不调后端；保留现有 localStorage 断点与 IndexedDB `typeHistory` 表（只停止写入）。
- 同步失败静默：不弹错、不阻塞训练、不重试提示。
- SRS：仅对 egregious 的卡片调用 `upsertCardProgress`，参数来自 `calculateSRS(card.srs, 'again')`，`Promise.allSettled` 失败静默。
- 全部测试必须 TDD：先写失败测试，看到失败原因后再写最小实现。

---

### Task 1: 后端 schema + 仓储层（type_entries / type_sessions）

**Files:**
- Create: `moyan-backend/migrations/007_type.sql`
- Create: `moyan-backend/src/models/type.rs`
- Modify: `moyan-backend/src/models/mod.rs`（注册 `type` 模块）
- Modify: `moyan-backend/src/repositories/mod.rs`（`TypeRepository` trait + `Repository` 约束）
- Modify: `moyan-backend/src/repositories/sqlite.rs`（实现 + 测试）
- Modify: `moyan-backend/src/repositories/mongodb.rs`（stub 实现）

**Interfaces:**
- Consumes: 现有 `RepositoryError`、`SqliteRepositories::connect`、`new_prefixed_id`、测试内 `find_or_create`。
- Produces: trait 方法（Task 2 使用）：
  - `type_session_insert(&self, user_id: &str, session: &TypeSession) -> Result<bool, RepositoryError>`（重复 id 返回 `false`）
  - `type_entries_insert(&self, user_id: &str, entries: &[TypeEntry]) -> Result<usize, RepositoryError>`（返回实际插入数）
  - `type_recent_sessions(&self, user_id: &str, limit: i64) -> Result<Vec<TypeSession>, RepositoryError>`
  - `type_daily_trend(&self, user_id: &str, days: i64) -> Result<Vec<TypeDailyTrend>, RepositoryError>`
  - `type_mastery_rows(&self, user_id: &str) -> Result<Vec<TypeMasteryRow>, RepositoryError>`
- 数据模型（snake_case，serde 默认字段名）：
  - `TypeEntry { id, card_id, deck_id, mode, correct_chars, wrong_chars, accuracy, wpm, duration_ms, egregious: bool, created_at: DateTime<Utc> }`
  - `TypeSession { id, deck_id: Option<String>, deck_name: Option<String>, mode, total_cards, completed, skipped, egregious_count, avg_accuracy, avg_wpm, duration_ms, created_at }`
  - `TypeDailyTrend { date: String, sessions: i64, avg_accuracy: f64, avg_wpm: f64 }`
  - `TypeMasteryRow { card_id, accuracy: f64, egregious_count: i64, last_practiced_at: Option<DateTime<Utc>> }`

- [ ] **Step 1: 写迁移文件**

`moyan-backend/migrations/007_type.sql`：

```sql
CREATE TABLE IF NOT EXISTS type_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  correct_chars INTEGER NOT NULL,
  wrong_chars INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  egregious INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type_entries_user_created ON type_entries(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_type_entries_card ON type_entries(owner_user_id, card_id);

CREATE TABLE IF NOT EXISTS type_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT,
  deck_name TEXT,
  mode TEXT NOT NULL,
  total_cards INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  egregious_count INTEGER NOT NULL DEFAULT 0,
  avg_accuracy REAL NOT NULL,
  avg_wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type_sessions_user_created ON type_sessions(owner_user_id, created_at);
```

- [ ] **Step 2: 写模型（先于 trait 测试，让测试可编译）**

`moyan-backend/src/models/type.rs`：

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeEntry {
    pub id: String,
    pub card_id: String,
    pub deck_id: String,
    pub mode: String,
    pub correct_chars: i64,
    pub wrong_chars: i64,
    pub accuracy: f64,
    pub wpm: f64,
    pub duration_ms: i64,
    pub egregious: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSession {
    pub id: String,
    pub deck_id: Option<String>,
    pub deck_name: Option<String>,
    pub mode: String,
    pub total_cards: i64,
    pub completed: i64,
    pub skipped: i64,
    pub egregious_count: i64,
    pub avg_accuracy: f64,
    pub avg_wpm: f64,
    pub duration_ms: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDailyTrend {
    pub date: String,
    pub sessions: i64,
    pub avg_accuracy: f64,
    pub avg_wpm: f64,
}

/// Raw per-card aggregates; TypeService derives the 0-100 mastery score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMasteryRow {
    pub card_id: String,
    pub accuracy: f64,
    pub egregious_count: i64,
    pub last_practiced_at: Option<DateTime<Utc>>,
}
```

`moyan-backend/src/models/mod.rs` 增加 `mod type;` 与 `pub use type::*;`。

- [ ] **Step 3: 写失败测试（幂等 + 聚合 + 用户隔离）**

在 `moyan-backend/src/repositories/sqlite.rs` 的 `mod tests` 里追加（同时把 `TypeEntry, TypeSession, TypeDailyTrend, TypeMasteryRow` 加进该文件顶部 `use crate::models::{...}`）：

```rust
#[tokio::test]
async fn type_session_and_entries_are_idempotent() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    let user = repo
        .find_or_create(UserIdentity {
            provider: "test",
            provider_id: "type-dup-1",
            name: "Type Dup",
            email: "type-dup@example.com",
            avatar: None,
        })
        .await?;
    let session = TypeSession {
        id: "ts_dup".into(),
        deck_id: None,
        deck_name: Some("全部词汇".into()),
        mode: "word".into(),
        total_cards: 2,
        completed: 1,
        skipped: 1,
        egregious_count: 1,
        avg_accuracy: 0.7,
        avg_wpm: 20.0,
        duration_ms: 60_000,
        created_at: Utc::now(),
    };
    let entry = TypeEntry {
        id: "te_dup".into(),
        card_id: "card_x".into(),
        deck_id: "deck_x".into(),
        mode: "word".into(),
        correct_chars: 7,
        wrong_chars: 3,
        accuracy: 0.7,
        wpm: 21.0,
        duration_ms: 4_000,
        egregious: true,
        created_at: Utc::now(),
    };

    assert!(repo.type_session_insert(&user.id, &session).await?);
    assert!(!repo.type_session_insert(&user.id, &session).await?);
    assert_eq!(repo.type_entries_insert(&user.id, &[entry.clone()]).await?, 1);
    assert_eq!(repo.type_entries_insert(&user.id, &[entry]).await?, 0);
    Ok(())
}

#[tokio::test]
async fn type_stats_aggregate_trend_and_mastery() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    let user = repo
        .find_or_create(UserIdentity {
            provider: "test",
            provider_id: "type-stats-1",
            name: "Type Stats",
            email: "type-stats@example.com",
            avatar: None,
        })
        .await?;
    let day1: DateTime<Utc> = (Utc::now() - Duration::days(1))
        .with_hour(10).unwrap().with_minute(0).unwrap().with_second(0).unwrap();
    let day2: DateTime<Utc> = Utc::now();
    let sessions = vec![
        TypeSession {
            id: "ts_a".into(),
            deck_id: Some("deck_a".into()),
            deck_name: Some("A".into()),
            mode: "word".into(),
            total_cards: 2,
            completed: 2,
            skipped: 0,
            egregious_count: 0,
            avg_accuracy: 0.9,
            avg_wpm: 30.0,
            duration_ms: 60_000,
            created_at: day1,
        },
        TypeSession {
            id: "ts_b".into(),
            deck_id: None,
            deck_name: Some("全部词汇".into()),
            mode: "sentence".into(),
            total_cards: 3,
            completed: 2,
            skipped: 1,
            egregious_count: 2,
            avg_accuracy: 0.5,
            avg_wpm: 15.0,
            duration_ms: 90_000,
            created_at: day2,
        },
        TypeSession {
            id: "ts_c".into(),
            deck_id: None,
            deck_name: None,
            mode: "word".into(),
            total_cards: 1,
            completed: 1,
            skipped: 0,
            egregious_count: 0,
            avg_accuracy: 0.8,
            avg_wpm: 25.0,
            duration_ms: 30_000,
            created_at: day2,
        },
    ];
    for s in &sessions {
        repo.type_session_insert(&user.id, s).await?;
    }
    let entries = vec![
        TypeEntry {
            id: "te_a1".into(),
            card_id: "card_a".into(),
            deck_id: "deck_a".into(),
            mode: "word".into(),
            correct_chars: 9,
            wrong_chars: 1,
            accuracy: 0.9,
            wpm: 30.0,
            duration_ms: 4_000,
            egregious: false,
            created_at: day1,
        },
        TypeEntry {
            id: "te_b1".into(),
            card_id: "card_b".into(),
            deck_id: "deck_a".into(),
            mode: "word".into(),
            correct_chars: 5,
            wrong_chars: 5,
            accuracy: 0.5,
            wpm: 15.0,
            duration_ms: 5_000,
            egregious: true,
            created_at: day2,
        },
        TypeEntry {
            id: "te_b2".into(),
            card_id: "card_b".into(),
            deck_id: "deck_a".into(),
            mode: "word".into(),
            correct_chars: 0,
            wrong_chars: 0,
            accuracy: 0.0,
            wpm: 0.0,
            duration_ms: 1_000,
            egregious: true,
            created_at: day2,
        },
    ];
    repo.type_entries_insert(&user.id, &entries).await?;

    let recent = repo.type_recent_sessions(&user.id, 20).await?;
    assert_eq!(recent.len(), 3);
    assert_eq!(recent[0].id, "ts_c"); // newest first
    assert_eq!(recent[2].id, "ts_a");

    let trend = repo.type_daily_trend(&user.id, 30).await?;
    assert_eq!(trend.len(), 2);
    assert_eq!(trend[0].date, day1.date_naive().to_string());
    assert_eq!(trend[0].sessions, 1);
    assert_eq!(trend[1].date, day2.date_naive().to_string());
    assert_eq!(trend[1].sessions, 2);

    let mastery = repo.type_mastery_rows(&user.id).await?;
    assert_eq!(mastery.len(), 2); // only practiced cards
    let card_a = mastery.iter().find(|m| m.card_id == "card_a").unwrap();
    let card_b = mastery.iter().find(|m| m.card_id == "card_b").unwrap();
    assert!((card_a.accuracy - 0.9).abs() < 1e-9);
    assert_eq!(card_a.egregious_count, 0);
    assert!((card_b.accuracy - 0.5).abs() < 1e-9);
    assert_eq!(card_b.egregious_count, 2);
    Ok(())
}

#[tokio::test]
async fn type_data_is_isolated_per_user() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    let first = repo
        .find_or_create(UserIdentity {
            provider: "test",
            provider_id: "type-iso-1",
            name: "Iso One",
            email: "iso-one@example.com",
            avatar: None,
        })
        .await?;
    let second = repo
        .find_or_create(UserIdentity {
            provider: "test",
            provider_id: "type-iso-2",
            name: "Iso Two",
            email: "iso-two@example.com",
            avatar: None,
        })
        .await?;
    repo.type_session_insert(
        &first.id,
        &TypeSession {
            id: "ts_iso".into(),
            deck_id: None,
            deck_name: None,
            mode: "word".into(),
            total_cards: 1,
            completed: 1,
            skipped: 0,
            egregious_count: 0,
            avg_accuracy: 1.0,
            avg_wpm: 20.0,
            duration_ms: 10_000,
            created_at: Utc::now(),
        },
    )
    .await?;
    assert!(repo.type_recent_sessions(&second.id, 20).await?.is_empty());
    assert!(repo.type_mastery_rows(&second.id).await?.is_empty());
    Ok(())
}
```

还需要在 `mod tests` 里测试 trend 的 `day1.date_naive().to_string()` 与 `substr(created_at,1,10)` 的一致性——它们都以 UTC 日期为准（前端始终发送 UTC `Z` 字符串，sqlx 绑定 `DateTime<Utc>` 也输出 UTC）。

- [ ] **Step 4: 运行测试确认失败**

Run: `cd moyan-backend && cargo test type_ 2>&1 | tail -30`
Expected: 编译失败——`type_session_insert` 等方法未定义（feature missing）。

- [ ] **Step 5: 实现 trait + sqlite + mongo stub**

`moyan-backend/src/repositories/mod.rs`：

```rust
#[async_trait]
pub trait TypeRepository: Send + Sync {
    /// Insert a session; returns false when the id already exists (idempotent).
    async fn type_session_insert(
        &self,
        user_id: &str,
        session: &TypeSession,
    ) -> Result<bool, RepositoryError>;
    /// Insert entries, skipping ids that already exist; returns number inserted.
    async fn type_entries_insert(
        &self,
        user_id: &str,
        entries: &[TypeEntry],
    ) -> Result<usize, RepositoryError>;
    async fn type_recent_sessions(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<TypeSession>, RepositoryError>;
    async fn type_daily_trend(
        &self,
        user_id: &str,
        days: i64,
    ) -> Result<Vec<TypeDailyTrend>, RepositoryError>;
    async fn type_mastery_rows(
        &self,
        user_id: &str,
    ) -> Result<Vec<TypeMasteryRow>, RepositoryError>;
}
```

把 `TypeEntry, TypeSession, TypeDailyTrend, TypeMasteryRow` 加入 `use crate::models::{...}`，并把 `TypeRepository` 加入 `Repository` supertrait 与 blanket impl：

```rust
pub trait Repository:
    UserRepository
    + LearningRepository
    + SettingsRepository
    + VocabularyRepository
    + TypeRepository
    + HealthRepository
{
}

impl<T> Repository for T where
    T: UserRepository
        + LearningRepository
        + SettingsRepository
        + VocabularyRepository
        + TypeRepository
        + HealthRepository
{
}
```

`moyan-backend/src/repositories/sqlite.rs` 顶部 `use` 增加新模型，文件里加 row 结构体与转换：

```rust
#[derive(sqlx::FromRow)]
struct TypeSessionRow {
    id: String,
    deck_id: Option<String>,
    deck_name: Option<String>,
    mode: String,
    total_cards: i64,
    completed: i64,
    skipped: i64,
    egregious_count: i64,
    avg_accuracy: f64,
    avg_wpm: f64,
    duration_ms: i64,
    created_at: DateTime<Utc>,
}

impl From<TypeSessionRow> for TypeSession {
    fn from(row: TypeSessionRow) -> Self {
        Self {
            id: row.id,
            deck_id: row.deck_id,
            deck_name: row.deck_name,
            mode: row.mode,
            total_cards: row.total_cards,
            completed: row.completed,
            skipped: row.skipped,
            egregious_count: row.egregious_count,
            avg_accuracy: row.avg_accuracy,
            avg_wpm: row.avg_wpm,
            duration_ms: row.duration_ms,
            created_at: row.created_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct TypeDailyTrendRow {
    date: String,
    sessions: i64,
    avg_accuracy: f64,
    avg_wpm: f64,
}

impl From<TypeDailyTrendRow> for TypeDailyTrend {
    fn from(row: TypeDailyTrendRow) -> Self {
        Self {
            date: row.date,
            sessions: row.sessions,
            avg_accuracy: row.avg_accuracy,
            avg_wpm: row.avg_wpm,
        }
    }
}

#[derive(sqlx::FromRow)]
struct TypeMasteryRowDb {
    card_id: String,
    correct_chars: i64,
    wrong_chars: i64,
    egregious_count: i64,
    last_practiced_at: Option<DateTime<Utc>>,
}

impl From<TypeMasteryRowDb> for TypeMasteryRow {
    fn from(row: TypeMasteryRowDb) -> Self {
        let total = row.correct_chars + row.wrong_chars;
        let accuracy = if total > 0 {
            row.correct_chars as f64 / total as f64
        } else {
            1.0
        };
        Self {
            card_id: row.card_id,
            accuracy,
            egregious_count: row.egregious_count,
            last_practiced_at: row.last_practiced_at,
        }
    }
}
```

`impl SqliteRepositories` 内（`impl VocabularyRepository for SqliteRepositories` 附近）加实现：

```rust
    async fn type_session_insert(
        &self,
        user_id: &str,
        session: &TypeSession,
    ) -> Result<bool, RepositoryError> {
        let result = sqlx::query(
            "INSERT INTO type_sessions (
                id, owner_user_id, deck_id, deck_name, mode, total_cards, completed, skipped,
                egregious_count, avg_accuracy, avg_wpm, duration_ms, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING",
        )
        .bind(&session.id)
        .bind(user_id)
        .bind(&session.deck_id)
        .bind(&session.deck_name)
        .bind(&session.mode)
        .bind(session.total_cards)
        .bind(session.completed)
        .bind(session.skipped)
        .bind(session.egregious_count)
        .bind(session.avg_accuracy)
        .bind(session.avg_wpm)
        .bind(session.duration_ms)
        .bind(session.created_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn type_entries_insert(
        &self,
        user_id: &str,
        entries: &[TypeEntry],
    ) -> Result<usize, RepositoryError> {
        let mut saved = 0usize;
        for entry in entries {
            let result = sqlx::query(
                "INSERT INTO type_entries (
                    id, owner_user_id, card_id, deck_id, mode, correct_chars, wrong_chars,
                    accuracy, wpm, duration_ms, egregious, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO NOTHING",
            )
            .bind(&entry.id)
            .bind(user_id)
            .bind(&entry.card_id)
            .bind(&entry.deck_id)
            .bind(&entry.mode)
            .bind(entry.correct_chars)
            .bind(entry.wrong_chars)
            .bind(entry.accuracy)
            .bind(entry.wpm)
            .bind(entry.duration_ms)
            .bind(if entry.egregious { 1 } else { 0 })
            .bind(entry.created_at)
            .execute(&self.pool)
            .await?;
            if result.rows_affected() > 0 {
                saved += 1;
            }
        }
        Ok(saved)
    }

    async fn type_recent_sessions(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<TypeSession>, RepositoryError> {
        let rows = sqlx::query_as::<_, TypeSessionRow>(
            "SELECT id, deck_id, deck_name, mode, total_cards, completed, skipped,
                    egregious_count, avg_accuracy, avg_wpm, duration_ms, created_at
             FROM type_sessions WHERE owner_user_id = ?
             ORDER BY created_at DESC LIMIT ?",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(TypeSession::from).collect())
    }

    async fn type_daily_trend(
        &self,
        user_id: &str,
        days: i64,
    ) -> Result<Vec<TypeDailyTrend>, RepositoryError> {
        let since = Utc::now() - Duration::days(days);
        let rows = sqlx::query_as::<_, TypeDailyTrendRow>(
            "SELECT substr(created_at, 1, 10) AS date,
                    COUNT(*) AS sessions,
                    AVG(avg_accuracy) AS avg_accuracy,
                    AVG(avg_wpm) AS avg_wpm
             FROM type_sessions
             WHERE owner_user_id = ? AND created_at >= ?
             GROUP BY substr(created_at, 1, 10)
             ORDER BY date",
        )
        .bind(user_id)
        .bind(since)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(TypeDailyTrend::from).collect())
    }

    async fn type_mastery_rows(
        &self,
        user_id: &str,
    ) -> Result<Vec<TypeMasteryRow>, RepositoryError> {
        let rows = sqlx::query_as::<_, TypeMasteryRowDb>(
            "SELECT card_id,
                    SUM(correct_chars) AS correct_chars,
                    SUM(wrong_chars) AS wrong_chars,
                    SUM(egregious) AS egregious_count,
                    MAX(created_at) AS last_practiced_at
             FROM type_entries
             WHERE owner_user_id = ?
             GROUP BY card_id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(TypeMasteryRow::from).collect())
    }
```

`moyan-backend/src/repositories/mongodb.rs`：给 `MongoRepositories` 加 5 个 stub（复制 `collect_job_*` 的模式）：

```rust
    async fn type_session_insert(
        &self,
        _user_id: &str,
        _session: &TypeSession,
    ) -> Result<bool, RepositoryError> {
        Err(RepositoryError::Configuration(
            "type practice requires sqlite backend".into(),
        ))
    }

    async fn type_entries_insert(
        &self,
        _user_id: &str,
        _entries: &[TypeEntry],
    ) -> Result<usize, RepositoryError> {
        Err(RepositoryError::Configuration(
            "type practice requires sqlite backend".into(),
        ))
    }

    async fn type_recent_sessions(
        &self,
        _user_id: &str,
        _limit: i64,
    ) -> Result<Vec<TypeSession>, RepositoryError> {
        Err(RepositoryError::Configuration(
            "type practice requires sqlite backend".into(),
        ))
    }

    async fn type_daily_trend(
        &self,
        _user_id: &str,
        _days: i64,
    ) -> Result<Vec<TypeDailyTrend>, RepositoryError> {
        Err(RepositoryError::Configuration(
            "type practice requires sqlite backend".into(),
        ))
    }

    async fn type_mastery_rows(
        &self,
        _user_id: &str,
    ) -> Result<Vec<TypeMasteryRow>, RepositoryError> {
        Err(RepositoryError::Configuration(
            "type practice requires sqlite backend".into(),
        ))
    }
```

`mongodb.rs` 顶部 `use crate::models::{...}` 增加 `TypeDailyTrend, TypeEntry, TypeMasteryRow, TypeSession`。

- [ ] **Step 6: 运行测试确认通过**

Run: `cd moyan-backend && cargo test type_ 2>&1 | tail -30`
Expected: 3 个 `type_*` 测试 PASS，全量测试无回归。

- [ ] **Step 7: Commit**

```bash
git add moyan-backend/migrations/007_type.sql moyan-backend/src/models/type.rs moyan-backend/src/models/mod.rs moyan-backend/src/repositories/mod.rs moyan-backend/src/repositories/sqlite.rs moyan-backend/src/repositories/mongodb.rs
git commit -m "feat(moyan): type practice repository (type_entries/type_sessions)"
```

---

### Task 2: 后端 TypeService + /api/type 路由

**Files:**
- Create: `moyan-backend/src/services/type.rs`
- Create: `moyan-backend/src/controllers/type.rs`
- Create: `moyan-backend/src/routes/type.rs`
- Modify: `moyan-backend/src/models/type.rs`（追加请求/响应模型）
- Modify: `moyan-backend/src/services/mod.rs`（注册 `TypeService`）
- Modify: `moyan-backend/src/routes/mod.rs`（注册 `type` 路由模块）
- Modify: `moyan-backend/src/main.rs`（nest `/api/type` + 路由测试）

**Interfaces:**
- Consumes: Task 1 的 `TypeRepository` 方法；现有 `AppState` / `Claims` / `success` / `jwt_middleware`。
- Produces:
  - `TypeSyncRequest { session: TypeSession, entries: Vec<TypeEntry> }`
  - `TypeSyncResponse { saved_session: bool, saved_entries: usize }`
  - `TypeMastery { card_id, accuracy, egregious_count, score: f64, last_practiced_at }`
  - `TypeStatsResponse { recent_sessions: Vec<TypeSession>, daily_trend: Vec<TypeDailyTrend>, mastery: Vec<TypeMastery> }`
  - `TypeService::sync(user_id, TypeSyncRequest) -> Result<TypeSyncResponse, AppError>`
  - `TypeService::stats(user_id) -> Result<TypeStatsResponse, AppError>`
  - `POST /api/type/sync`、`GET /api/type/stats`（均需 `Bearer` JWT）

- [ ] **Step 1: 追加请求/响应模型**

`moyan-backend/src/models/type.rs` 末尾追加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSyncRequest {
    pub session: TypeSession,
    pub entries: Vec<TypeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeSyncResponse {
    pub saved_session: bool,
    pub saved_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeMastery {
    pub card_id: String,
    pub accuracy: f64,
    pub egregious_count: i64,
    pub score: f64,
    pub last_practiced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeStatsResponse {
    pub recent_sessions: Vec<TypeSession>,
    pub daily_trend: Vec<TypeDailyTrend>,
    pub mastery: Vec<TypeMastery>,
}
```

- [ ] **Step 2: 写失败测试（路由级 400/200）**

`moyan-backend/src/main.rs` 的 `mod tests` 里追加 helper 与用例：

```rust
    fn test_state(repository: Arc<SqliteRepositories>) -> AppState {
        AppState {
            services: Services::new(repository),
            jwt_secret: "test-secret".to_string(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            google_redirect_url: String::new(),
            admin_token: String::new(),
        }
    }

    fn valid_type_payload() -> serde_json::Value {
        serde_json::json!({
            "session": {
                "id": "ts_http_1",
                "deck_id": null,
                "deck_name": "全部词汇",
                "mode": "word",
                "total_cards": 2,
                "completed": 2,
                "skipped": 0,
                "egregious_count": 0,
                "avg_accuracy": 0.9,
                "avg_wpm": 25.0,
                "duration_ms": 60_000,
                "created_at": "2026-08-01T08:00:00Z"
            },
            "entries": [
                {
                    "id": "te_http_1",
                    "card_id": "card_a",
                    "deck_id": "deck_a",
                    "mode": "word",
                    "correct_chars": 9,
                    "wrong_chars": 1,
                    "accuracy": 0.9,
                    "wpm": 25.0,
                    "duration_ms": 4_000,
                    "egregious": false,
                    "created_at": "2026-08-01T08:00:04Z"
                }
            ]
        })
    }

    #[tokio::test]
    async fn type_sync_saves_session_and_entries() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_type_payload())?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);

        let body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX).await?,
        )?;
        assert_eq!(body["data"]["saved_session"], true);
        assert_eq!(body["data"]["saved_entries"], 1);
        Ok(())
    }

    #[tokio::test]
    async fn type_sync_rejects_invalid_mode_with_400() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let mut payload = valid_type_payload();
        payload["session"]["mode"] = serde_json::json!("typing");
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[tokio::test]
    async fn type_sync_rejects_out_of_range_accuracy_with_400() -> anyhow::Result<()> {
        let app = build_app(test_state(Arc::new(
            SqliteRepositories::connect("sqlite::memory:").await?,
        )));
        let mut payload = valid_type_payload();
        payload["entries"][0]["accuracy"] = serde_json::json!(1.5);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload)?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        Ok(())
    }

    #[tokio::test]
    async fn type_stats_returns_practiced_mastery() -> anyhow::Result<()> {
        let repository = Arc::new(SqliteRepositories::connect("sqlite::memory:").await?);
        let app = build_app(test_state(repository.clone()));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/type/sync")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_type_payload())?))?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/type/stats")
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX).await?,
        )?;
        assert_eq!(body["data"]["recent_sessions"].as_array().unwrap().len(), 1);
        assert_eq!(body["data"]["mastery"].as_array().unwrap().len(), 1);
        let mastery = &body["data"]["mastery"][0];
        assert_eq!(mastery["card_id"], "card_a");
        assert!(mastery["score"].as_f64().unwrap() > 0.0);
        Ok(())
    }
```

注意：测试里要用 `axum::body::to_bytes(...)` 读取 body——检查 main.rs 现有测试是否已引用 `axum::body`，若没有则 `use axum::body::Body` 已存在（现有测试已用），`to_bytes` 需要 `use axum::body::to_bytes;` 或完整路径。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd moyan-backend && cargo test type_sync_ type_stats_ 2>&1 | tail -30`
Expected: 编译失败——`/api/type/sync` 路由不存在（404）或 `state.services.typing` 未定义。

- [ ] **Step 4: 实现 TypeService**

`moyan-backend/src/services/type.rs`：

```rust
use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::models::{
    TypeEntry, TypeMastery, TypeMasteryRow, TypeSession, TypeStatsResponse, TypeSyncRequest,
    TypeSyncResponse,
};
use crate::repositories::Repository;

pub const TYPE_SYNC_ENTRY_LIMIT: usize = 2000;
pub const TYPE_RECENT_SESSION_LIMIT: i64 = 20;
pub const TYPE_TREND_DAYS: i64 = 30;
const VALID_TYPE_MODES: &[&str] = &["word", "sentence"];
const MASTERY_EGREGIOUS_PENALTY: f64 = 15.0;

#[derive(Clone)]
pub struct TypeService {
    repository: Arc<dyn Repository>,
}

impl TypeService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn sync(
        &self,
        user_id: &str,
        req: TypeSyncRequest,
    ) -> Result<TypeSyncResponse, AppError> {
        if req.entries.len() > TYPE_SYNC_ENTRY_LIMIT {
            return Err(AppError::BadRequest(format!(
                "too many entries: {} (max {TYPE_SYNC_ENTRY_LIMIT})",
                req.entries.len()
            )));
        }
        validate_session(&req.session)?;
        for entry in &req.entries {
            validate_entry(entry)?;
        }
        let saved_session = self
            .repository
            .type_session_insert(user_id, &req.session)
            .await?;
        let saved_entries = self
            .repository
            .type_entries_insert(user_id, &req.entries)
            .await?;
        Ok(TypeSyncResponse {
            saved_session,
            saved_entries,
        })
    }

    pub async fn stats(&self, user_id: &str) -> Result<TypeStatsResponse, AppError> {
        let recent_sessions = self
            .repository
            .type_recent_sessions(user_id, TYPE_RECENT_SESSION_LIMIT)
            .await?;
        let daily_trend = self
            .repository
            .type_daily_trend(user_id, TYPE_TREND_DAYS)
            .await?;
        let rows = self.repository.type_mastery_rows(user_id).await?;
        let mastery = rows.into_iter().map(mastery_from_row).collect();
        Ok(TypeStatsResponse {
            recent_sessions,
            daily_trend,
            mastery,
        })
    }
}

fn validate_session(session: &TypeSession) -> Result<(), AppError> {
    if !VALID_TYPE_MODES.contains(&session.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid mode '{}'; expected word or sentence",
            session.mode
        )));
    }
    if !(0.0..=1.0).contains(&session.avg_accuracy) {
        return Err(AppError::BadRequest(
            "avg_accuracy must be between 0 and 1".into(),
        ));
    }
    if session.total_cards < 0
        || session.completed < 0
        || session.skipped < 0
        || session.egregious_count < 0
        || session.duration_ms < 0
    {
        return Err(AppError::BadRequest(
            "session counts and duration must be non-negative".into(),
        ));
    }
    Ok(())
}

fn validate_entry(entry: &TypeEntry) -> Result<(), AppError> {
    if !VALID_TYPE_MODES.contains(&entry.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "invalid mode '{}'; expected word or sentence",
            entry.mode
        )));
    }
    if !(0.0..=1.0).contains(&entry.accuracy) {
        return Err(AppError::BadRequest(
            "accuracy must be between 0 and 1".into(),
        ));
    }
    if entry.correct_chars < 0
        || entry.wrong_chars < 0
        || entry.duration_ms < 0
        || entry.wpm < 0.0
    {
        return Err(AppError::BadRequest(
            "entry stats must be non-negative".into(),
        ));
    }
    Ok(())
}

fn mastery_from_row(row: TypeMasteryRow) -> TypeMastery {
    let score = (row.accuracy * 100.0 - row.egregious_count as f64 * MASTERY_EGREGIOUS_PENALTY)
        .clamp(0.0, 100.0)
        .round();
    TypeMastery {
        card_id: row.card_id,
        accuracy: row.accuracy,
        egregious_count: row.egregious_count,
        score,
        last_practiced_at: row.last_practiced_at,
    }
}
```

- [ ] **Step 5: 控制器 + 路由 + 装配**

`moyan-backend/src/controllers/type.rs`：

```rust
use axum::{extract::State, response::Json};

use crate::middleware::auth::Claims;
use crate::middleware::error::{success, AppError, AppState};
use crate::models::TypeSyncRequest;

pub async fn sync(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    axum::Json(req): axum::Json<TypeSyncRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state.services.typing.sync(&claims.sub, req).await?;
    Ok(success(result))
}

pub async fn stats(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(success(state.services.typing.stats(&claims.sub).await?))
}
```

`moyan-backend/src/routes/type.rs`：

```rust
use axum::{
    middleware,
    routing::{get, post},
    Router,
};

use crate::controllers::type;
use crate::middleware::auth::jwt_middleware;
use crate::middleware::error::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync", post(type::sync))
        .route("/stats", get(type::stats))
        .layer(middleware::from_fn(jwt_middleware))
}
```

`moyan-backend/src/routes/mod.rs` 加 `pub mod type;`。

`moyan-backend/src/services/mod.rs`：

```rust
mod type;
pub use type::TypeService;
```

`Services` 结构体加字段 `pub typing: TypeService`，`new()` 里加 `typing: TypeService::new(Arc::clone(&repository)),`。

`moyan-backend/src/main.rs`：

```rust
use crate::routes::{admin, auth, health, settings, sync, type, vocabulary};
// 在 Router 里加：
        .nest("/api/type", type::routes())
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd moyan-backend && cargo test type_ 2>&1 | tail -30`
Expected: Task 1 + Task 2 的 `type_*` 测试全部 PASS，全量测试无回归。

- [ ] **Step 7: Commit**

```bash
git add moyan-backend/src/models/type.rs moyan-backend/src/services/type.rs moyan-backend/src/services/mod.rs moyan-backend/src/controllers/type.rs moyan-backend/src/routes/type.rs moyan-backend/src/routes/mod.rs moyan-backend/src/main.rs
git commit -m "feat(moyan): add /api/type sync and stats endpoints"
```

---

### Task 3: 前端 API 客户端 + 纯函数会话逻辑

**Files:**
- Modify: `moyan-web/src/types/vocabulary.ts`（新增打字类型）
- Modify: `moyan-web/src/services/vocabularyApi.ts`（`syncTypePractice` / `getTypeStats`）
- Create: `moyan-web/src/services/typePractice.ts`（纯函数）
- Create: `moyan-web/src/services/typePractice.test.ts`
- Modify: `moyan-web/src/services/vocabularyApi.test.ts`（新 API 用例）

**Interfaces:**
- Consumes: 现有 `apiRequest<T>`、`calculateSRS`、`SRSData`。
- Produces（Task 4 使用）：
  - `type TypeMode = "word" | "sentence"`
  - `TypeEntry { id, card_id, deck_id, mode, correct_chars, wrong_chars, accuracy, wpm, duration_ms, egregious, created_at }`
  - `TypeSession { id, deck_id: string | null, deck_name: string | null, mode, total_cards, completed, skipped, egregious_count, avg_accuracy, avg_wpm, duration_ms, created_at }`
  - `TypeStats { recent_sessions, daily_trend, mastery }`、`TypeMastery { card_id, accuracy, egregious_count, score, last_practiced_at }`
  - `isEgregious(correctChars, wrongChars, skipped): boolean`
  - `buildTypeEntry(input: TypeEntryInput): TypeEntry`
  - `buildTypeSession(input: TypeSessionInput): TypeSession`
  - `newPrefixedId(prefix: "ts_" | "te_"): string`
  - `egregiousSrsUpdates(entries, srsByCard): { cardId, srs }[]`
  - `toAgainUpsertBody(srs, lastReviewedAt?): UpsertCardProgressRequest`

- [ ] **Step 1: 写失败测试（纯函数）**

`moyan-web/src/services/typePractice.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { SRSData } from "../db";
import { calculateSRS } from "./srs";
import {
  buildTypeEntry,
  buildTypeSession,
  egregiousSrsUpdates,
  isEgregious,
  toAgainUpsertBody,
  wpmOf,
} from "./typePractice";

describe("isEgregious", () => {
  it("marks skipped words as egregious", () => {
    expect(isEgregious(10, 0, true)).toBe(true);
  });

  it("marks accuracy below 0.70 as egregious", () => {
    expect(isEgregious(69, 31, false)).toBe(true);
  });

  it("does not mark accuracy exactly 0.70 as egregious", () => {
    expect(isEgregious(7, 3, false)).toBe(false);
  });

  it("does not mark high accuracy as egregious", () => {
    expect(isEgregious(9, 1, false)).toBe(false);
  });

  it("marks a word with no typed chars as egregious", () => {
    expect(isEgregious(0, 0, false)).toBe(true);
  });
});

describe("buildTypeEntry", () => {
  it("computes accuracy, wpm and egregious flag", () => {
    const entry = buildTypeEntry({
      id: "te_1",
      cardId: "card_a",
      deckId: "deck_a",
      mode: "word",
      correctChars: 10,
      wrongChars: 2,
      durationMs: 60_000,
      skipped: false,
      createdAt: "2026-08-01T08:00:00Z",
    });
    expect(entry.accuracy).toBeCloseTo(10 / 12, 10);
    expect(entry.wpm).toBeCloseTo(2, 10); // 10 chars / 5 / 1 minute
    expect(entry.egregious).toBe(false);
  });

  it("marks skipped entries as egregious", () => {
    const entry = buildTypeEntry({
      id: "te_2",
      cardId: "card_b",
      deckId: "deck_a",
      mode: "word",
      correctChars: 0,
      wrongChars: 0,
      durationMs: 1_000,
      skipped: true,
      createdAt: "2026-08-01T08:00:01Z",
    });
    expect(entry.egregious).toBe(true);
  });
});

describe("buildTypeSession", () => {
  it("aggregates completed, skipped, egregious, accuracy and wpm", () => {
    const entries = [
      buildTypeEntry({
        id: "te_a",
        cardId: "card_a",
        deckId: "deck_a",
        mode: "word",
        correctChars: 10,
        wrongChars: 0,
        durationMs: 30_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:00Z",
      }),
      buildTypeEntry({
        id: "te_b",
        cardId: "card_b",
        deckId: "deck_a",
        mode: "word",
        correctChars: 0,
        wrongChars: 0,
        durationMs: 2_000,
        skipped: true,
        createdAt: "2026-08-01T08:00:30Z",
      }),
      buildTypeEntry({
        id: "te_c",
        cardId: "card_c",
        deckId: "deck_a",
        mode: "word",
        correctChars: 6,
        wrongChars: 4,
        durationMs: 28_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:35Z",
      }),
    ];
    const session = buildTypeSession({
      id: "ts_1",
      deckId: "deck_a",
      deckName: "Rust语言核心",
      mode: "word",
      entries,
      totalCards: 3,
      skipped: 1,
      durationMs: 60_000,
      createdAt: "2026-08-01T08:01:00Z",
    });
    expect(session.completed).toBe(2);
    expect(session.skipped).toBe(1);
    expect(session.egregious_count).toBe(2);
    expect(session.avg_accuracy).toBeCloseTo((1 + 0 + 0.6) / 3, 10);
    expect(session.avg_wpm).toBeCloseTo((4 + 0 + 2.5714285714) / 3, 6);
  });
});

describe("SRS again updates", () => {
  const srs: SRSData = {
    interval: 5,
    repetitions: 2,
    easeFactor: 2.5,
    dueDate: new Date("2026-08-05T00:00:00Z"),
    status: "review",
  };

  it("maps only egregious entries with known srs", () => {
    const entries = [
      buildTypeEntry({
        id: "te_1",
        cardId: "card_a",
        deckId: "deck_a",
        mode: "word",
        correctChars: 0,
        wrongChars: 0,
        durationMs: 1_000,
        skipped: true,
        createdAt: "2026-08-01T08:00:00Z",
      }),
      buildTypeEntry({
        id: "te_2",
        cardId: "card_b",
        deckId: "deck_a",
        mode: "word",
        correctChars: 10,
        wrongChars: 0,
        durationMs: 5_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:05Z",
      }),
    ];
    const updates = egregiousSrsUpdates(
      entries,
      new Map([["card_a", srs]])
    );
    expect(updates.map((u) => u.cardId)).toEqual(["card_a"]);
  });

  it("builds upsert body matching calculateSRS(again)", () => {
    const updated = calculateSRS(srs, "again");
    const body = toAgainUpsertBody(srs, "2026-08-01T09:00:00Z");
    expect(body.srs_status).toBe(updated.status);
    expect(body.interval).toBe(updated.interval);
    expect(body.repetitions).toBe(updated.repetitions);
    expect(body.ease_factor).toBe(updated.easeFactor);
    expect(body.due_date).toBe(updated.dueDate.toISOString());
    expect(body.last_reviewed_at).toBe("2026-08-01T09:00:00Z");
  });
});
```

`wpmOf` 也加两个直接断言（0 时长 → 0；正常 → chars/5/分钟）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-web && npx vitest run src/services/typePractice.test.ts`
Expected: FAIL——`Cannot find module './typePractice'` 或函数未定义。

- [ ] **Step 3: 实现类型 + API + 纯函数**

`moyan-web/src/types/vocabulary.ts` 追加：

```ts
export type TypeMode = "word" | "sentence";

export interface TypeEntry {
  id: string;
  card_id: string;
  deck_id: string;
  mode: TypeMode;
  correct_chars: number;
  wrong_chars: number;
  accuracy: number;
  wpm: number;
  duration_ms: number;
  egregious: boolean;
  created_at: string;
}

export interface TypeSession {
  id: string;
  deck_id: string | null;
  deck_name: string | null;
  mode: TypeMode;
  total_cards: number;
  completed: number;
  skipped: number;
  egregious_count: number;
  avg_accuracy: number;
  avg_wpm: number;
  duration_ms: number;
  created_at: string;
}

export interface TypeSyncRequest {
  session: TypeSession;
  entries: TypeEntry[];
}

export interface TypeSyncResponse {
  saved_session: boolean;
  saved_entries: number;
}

export interface TypeDailyTrend {
  date: string;
  sessions: number;
  avg_accuracy: number;
  avg_wpm: number;
}

export interface TypeMastery {
  card_id: string;
  accuracy: number;
  egregious_count: number;
  score: number;
  last_practiced_at: string | null;
}

export interface TypeStats {
  recent_sessions: TypeSession[];
  daily_trend: TypeDailyTrend[];
  mastery: TypeMastery[];
}
```

`moyan-web/src/services/vocabularyApi.ts` 追加（import 里加 `TypeStats, TypeSyncRequest, TypeSyncResponse`）：

```ts
export async function syncTypePractice(
  body: TypeSyncRequest
): Promise<TypeSyncResponse> {
  return apiRequest<TypeSyncResponse>("/api/type/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getTypeStats(): Promise<TypeStats> {
  return apiRequest<TypeStats>("/api/type/stats");
}
```

`moyan-web/src/services/typePractice.ts`：

```ts
import type { TypeEntry, TypeMode, TypeSession } from "@/types/vocabulary";
import type { SRSData } from "../db";
import { calculateSRS } from "./srs";

export const EGREGIOUS_ACCURACY_THRESHOLD = 0.7;
export const TYPE_SYNC_ENTRY_LIMIT = 2000;

export function accuracyOf(correctChars: number, wrongChars: number): number {
  const total = correctChars + wrongChars;
  return total === 0 ? 0 : correctChars / total;
}

export function wpmOf(correctChars: number, durationMs: number): number {
  const minutes = durationMs / 60000;
  return minutes > 0 ? correctChars / 5 / minutes : 0;
}

export function isEgregious(
  correctChars: number,
  wrongChars: number,
  skipped: boolean
): boolean {
  if (skipped) return true;
  return accuracyOf(correctChars, wrongChars) < EGREGIOUS_ACCURACY_THRESHOLD;
}

export interface TypeEntryInput {
  id: string;
  cardId: string;
  deckId: string;
  mode: TypeMode;
  correctChars: number;
  wrongChars: number;
  durationMs: number;
  skipped: boolean;
  createdAt: string;
}

export function buildTypeEntry(input: TypeEntryInput): TypeEntry {
  return {
    id: input.id,
    card_id: input.cardId,
    deck_id: input.deckId,
    mode: input.mode,
    correct_chars: input.correctChars,
    wrong_chars: input.wrongChars,
    accuracy: accuracyOf(input.correctChars, input.wrongChars),
    wpm: wpmOf(input.correctChars, input.durationMs),
    duration_ms: input.durationMs,
    egregious: isEgregious(
      input.correctChars,
      input.wrongChars,
      input.skipped
    ),
    created_at: input.createdAt,
  };
}

export interface TypeSessionInput {
  id: string;
  deckId: string | null;
  deckName: string | null;
  mode: TypeMode;
  entries: TypeEntry[];
  totalCards: number;
  skipped: number;
  durationMs: number;
  createdAt: string;
}

export function buildTypeSession(input: TypeSessionInput): TypeSession {
  const avg = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    id: input.id,
    deck_id: input.deckId,
    deck_name: input.deckName,
    mode: input.mode,
    total_cards: input.totalCards,
    completed: input.entries.length - input.skipped,
    skipped: input.skipped,
    egregious_count: input.entries.filter((e) => e.egregious).length,
    avg_accuracy: avg(input.entries.map((e) => e.accuracy)),
    avg_wpm: avg(input.entries.map((e) => e.wpm)),
    duration_ms: input.durationMs,
    created_at: input.createdAt,
  };
}

export function newPrefixedId(prefix: "ts_" | "te_"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function egregiousSrsUpdates(
  entries: TypeEntry[],
  srsByCard: Map<string, SRSData>
): Array<{ cardId: string; srs: SRSData }> {
  const updates: Array<{ cardId: string; srs: SRSData }> = [];
  for (const entry of entries) {
    if (!entry.egregious) continue;
    const srs = srsByCard.get(entry.card_id);
    if (srs) updates.push({ cardId: entry.card_id, srs });
  }
  return updates;
}

export function toAgainUpsertBody(
  srs: SRSData,
  lastReviewedAt = new Date().toISOString()
) {
  const updated = calculateSRS(srs, "again");
  return {
    srs_status: updated.status,
    interval: updated.interval,
    repetitions: updated.repetitions,
    ease_factor: updated.easeFactor,
    due_date: updated.dueDate.toISOString(),
    last_reviewed_at: lastReviewedAt,
  };
}
```

- [ ] **Step 4: 加 API 客户端测试**

`moyan-web/src/services/vocabularyApi.test.ts` 追加（import 加 `getTypeStats, syncTypePractice`）：

```ts
  it("syncs type practice with JSON body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { saved_session: true, saved_entries: 1 },
      }),
    });

    const result = await syncTypePractice({
      session: {
        id: "ts_1",
        deck_id: null,
        deck_name: "全部词汇",
        mode: "word",
        total_cards: 1,
        completed: 1,
        skipped: 0,
        egregious_count: 0,
        avg_accuracy: 1,
        avg_wpm: 20,
        duration_ms: 10_000,
        created_at: "2026-08-01T08:00:00Z",
      },
      entries: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/type\/sync$/),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.saved_entries).toBe(1);
  });

  it("fetches type stats", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { recent_sessions: [], daily_trend: [], mastery: [] },
      }),
    });

    const stats = await getTypeStats();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/type\/stats$/),
      expect.anything()
    );
    expect(stats.mastery).toEqual([]);
  });
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd moyan-web && npx vitest run src/services/typePractice.test.ts src/services/vocabularyApi.test.ts`
Expected: PASS（2 个文件全绿）。

- [ ] **Step 6: Commit**

```bash
git add moyan-web/src/types/vocabulary.ts moyan-web/src/services/vocabularyApi.ts moyan-web/src/services/typePractice.ts moyan-web/src/services/typePractice.test.ts moyan-web/src/services/vocabularyApi.test.ts
git commit -m "feat(web): type practice api client and session logic"
```

---

### Task 4: TypeTraining.tsx 集成（收集 / 同步 / 排序 / SRS / tsc 修复）

**Files:**
- Modify: `moyan-web/src/pages/TypeTraining.tsx`

**Interfaces:**
- Consumes: Task 3 的 `buildTypeEntry` / `buildTypeSession` / `newPrefixedId` / `egregiousSrsUpdates` / `toAgainUpsertBody`；`listStudyCards` / `getTypeStats` / `syncTypePractice` / `upsertCardProgress`；`StudyCard`、`CardProgress`、`TypeMastery` 类型。
- Produces: 无（纯集成）。

改动点（全部在一个文件内，按顺序编辑）：

- [ ] **Step 1: 修复两处 tsc 报错（先做，让基线干净）**

`src/pages/TypeTraining.tsx` 726–732 行：

```ts
  const wordProgress = charInfos.length > 0
    ? Math.round((charInfos.filter(ch => ch.state !== 'pending').length / charInfos.length) * 100)
    : 0;
  const targetPendingTotal = charInfos.filter((_, i) => {
```

即：删掉 `|| (mode === 'sentence' && ch.state === 'correct' && !ch.inputChar)`（不可达分支），并把未使用的 `info` 参数改为 `_`。

Run: `cd moyan-web && npm run check`
Expected: 0 errors。

- [ ] **Step 2: imports 与类型扩展**

```ts
import type { Card as LocalCard, Deck as LocalDeck, SRSData } from '../db';
import {
  getTypeStats,
  hasVocabularyBackend,
  listDecks,
  listStudyCards,
  syncTypePractice,
  upsertCardProgress,
} from '../services/vocabularyApi';
import type {
  CardProgress,
  StudyCard,
  TypeEntry,
  TypeMastery,
} from '@/types/vocabulary';
import {
  buildTypeEntry,
  buildTypeSession,
  egregiousSrsUpdates,
  newPrefixedId,
  toAgainUpsertBody,
} from '../services/typePractice';
```

`TypeCard` 增加 `deckId?: string;` 与 `srs?: SRSData;`。

- [ ] **Step 3: 加载路径改为 StudyCard 并携带 srs**

把 `mapApiTypeCard(card: ApiCard)` 换成：

```ts
function defaultSrs(): SRSData {
  return {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueDate: new Date(),
    status: 'new',
  };
}

function progressToSrs(progress: CardProgress | null): SRSData {
  if (!progress) return defaultSrs();
  return {
    interval: progress.interval,
    repetitions: progress.repetitions,
    easeFactor: progress.ease_factor,
    dueDate: new Date(progress.due_date),
    lastReviewed: progress.last_reviewed_at
      ? new Date(progress.last_reviewed_at)
      : undefined,
    status: (progress.srs_status as SRSData['status']) || 'new',
  };
}

function mapApiTypeCard(sc: StudyCard): TypeCard {
  const card = sc.card;
  return {
    id: card.id,
    deckId: card.deck_id,
    front: card.front,
    back: card.back,
    pronunciation: card.pronunciation,
    exampleText: card.examples?.[0]?.sentence_en || undefined,
    srs: progressToSrs(sc.progress),
  };
}
```

load 分支里 `listCards(deckId)` 全部替换为 `listStudyCards(deckId)`，返回 `StudyCard[]` 再 `.map(mapApiTypeCard)`；删除不再使用的 `listCards` import。

- [ ] **Step 4: 掌握分排序**

文件顶部加纯函数（放在 `sortCardsSmart` 旁边）：

```ts
async function sortByMastery(
  cards: TypeCard[],
  mastery: TypeMastery[] | null
): Promise<TypeCard[]> {
  if (!mastery || mastery.length === 0) return cards;
  const score = new Map(mastery.map((m) => [m.card_id, m.score]));
  // stable sort：低分优先；无记录卡片 score 取 MAX，保持原相对顺序
  return [...cards].sort(
    (a, b) =>
      (score.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (score.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
```

load 末尾把 `loaded = await sortCardsSmart(loaded);` 改为：

```ts
        if (backend) {
          let mastery: TypeMastery[] | null = null;
          try {
            mastery = (await getTypeStats()).mastery;
          } catch {
            // stats unavailable → 保持原顺序
          }
          loaded = await sortByMastery(loaded, mastery);
        } else {
          loaded = await sortCardsSmart(loaded);
        }
```

`handleRestart` 里同样逻辑（抽取成组件内 `applySort(loaded)` 函数复用，避免复制）。

- [ ] **Step 5: 单词级统计收集 refs**

组件内新增：

```ts
  const wordRef = useRef<{ cardId: string; correctChars: number; wrongChars: number; startedAt: number } | null>(null);
  const entriesRef = useRef<TypeEntry[]>([]);
  const skippedCountRef = useRef(0);
  const startTimeRef = useRef(0);
  const sessionSyncedRef = useRef(false);
```

`handleKeyDown` 里 `if (!isStarted)` 分支同时设置 `startTimeRef.current = Date.now();`；每次按键先确保当前词 tracking 存在：

```ts
    if (!wordRef.current || wordRef.current.cardId !== currentCard.id) {
      wordRef.current = {
        cardId: currentCard.id,
        correctChars: 0,
        wrongChars: 0,
        startedAt: Date.now(),
      };
    }
```

并在更新 `stats` 的同时更新 ref：

```ts
    if (wordRef.current) {
      wordRef.current.correctChars += isCorrect ? 1 : 0;
      wordRef.current.wrongChars += isCorrect ? 0 : 1;
    }
```

- [ ] **Step 6: 切词 finalize + 会话同步**

`goNextCard(isSkip)` 开头（删除旧 `recordHistory` 调用）加：

```ts
    if (currentCard && wordRef.current) {
      const w = wordRef.current;
      if (backend) {
        entriesRef.current.push(
          buildTypeEntry({
            id: newPrefixedId('te_'),
            cardId: currentCard.id,
            deckId: currentCard.deckId || deckId || 'all',
            mode,
            correctChars: w.correctChars,
            wrongChars: w.wrongChars,
            durationMs: Date.now() - w.startedAt,
            skipped: isSkip,
            createdAt: new Date().toISOString(),
          })
        );
        if (isSkip) skippedCountRef.current += 1;
      }
      wordRef.current = null;
    }
```

最后一张卡完成分支（`else { clearTypeProgress... }`）在 `setIsComplete(true)` 前先 `finalizeWord(false)` 再 `void syncSession(false)`。为复用，把上面 finalize 逻辑抽成组件内 `finalizeWord(card: TypeCard, skipped: boolean)`。

组件内新增同步函数（用 refs 避免闭包过期）：

```ts
  const syncSession = async (abandoned: boolean) => {
    if (!backend || sessionSyncedRef.current) return;
    const entries = [...entriesRef.current];
    if (abandoned && wordRef.current) {
      const w = wordRef.current;
      const card = cards.find((c) => c.id === w.cardId);
      if (card) {
        entries.push(
          buildTypeEntry({
            id: newPrefixedId('te_'),
            cardId: card.id,
            deckId: card.deckId || deckId || 'all',
            mode,
            correctChars: w.correctChars,
            wrongChars: w.wrongChars,
            durationMs: Date.now() - w.startedAt,
            skipped: true,
            createdAt: new Date().toISOString(),
          })
        );
      }
    }
    if (entries.length === 0) return;
    sessionSyncedRef.current = true;
    const session = buildTypeSession({
      id: newPrefixedId('ts_'),
      deckId,
      deckName: deckName || null,
      mode,
      entries,
      totalCards: cards.length,
      skipped: skippedCountRef.current + (abandoned ? 1 : 0),
      durationMs: Math.max(Date.now() - startTimeRef.current, 0),
      createdAt: new Date().toISOString(),
    });
    try {
      await syncTypePractice({ session, entries });
    } catch {
      // 静默失败，不打断训练
    }
    const srsByCard = new Map(
      cards.filter((c) => c.srs).map((c) => [c.id, c.srs!])
    );
    const updates = egregiousSrsUpdates(entries, srsByCard);
    if (updates.length > 0) {
      await Promise.allSettled(
        updates.map(({ cardId, srs }) =>
          upsertCardProgress(cardId, toAgainUpsertBody(srs))
        )
      );
    }
  };
```

`beforeunload` effect 里追加 `void syncSession(true);`（放弃 → 当前词 egregious），依赖数组补 `backend, cards, deckName, mode`。

`handleRestart` 里重置：`wordRef.current = null; entriesRef.current = []; skippedCountRef.current = 0; startTimeRef.current = 0; sessionSyncedRef.current = false;`。

删除不再使用的 `recordHistory` 函数与 `TypeHistory` 相关 import（`db.typeHistory` 保留读取用于本地排序；`clearHistory` 保留）。

- [ ] **Step 7: 验证**

Run: `cd moyan-web && npm run check && npx vitest run`
Expected: 0 errors，全部前端测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add moyan-web/src/pages/TypeTraining.tsx
git commit -m "feat(web): track and sync typing sessions with mastery sort and SRS again"
```

---

### Task 5: Stats 页打字训练区块 + i18n

**Files:**
- Modify: `moyan-web/src/pages/Stats.tsx`
- Modify: `moyan-web/src/i18n/translations.ts`（zh-CN + en 各加 7 个 key）

**Interfaces:**
- Consumes: `getTypeStats`、`hasVocabularyBackend`、`getCurrentUser`、`TypeStats`。
- Produces: 无。

- [ ] **Step 1: 加 i18n key**

`translations.ts` 的 `'zh-CN'` Stats 区加：

```ts
    'stats.type.title': '打字训练',
    'stats.type.recent': '最近会话',
    'stats.type.trend': '每日趋势',
    'stats.type.no.data': '暂无打字记录，练一练吧',
    'stats.type.deck': '词库',
    'stats.type.avg.accuracy': '平均准确率',
    'stats.type.avg.wpm': '平均 WPM',
```

`'en'` 区对应：

```ts
    'stats.type.title': 'Typing Practice',
    'stats.type.recent': 'Recent Sessions',
    'stats.type.trend': 'Daily Trend',
    'stats.type.no.data': 'No typing sessions yet',
    'stats.type.deck': 'Deck',
    'stats.type.avg.accuracy': 'Avg Accuracy',
    'stats.type.avg.wpm': 'Avg WPM',
```

- [ ] **Step 2: Stats.tsx 数据加载**

import 增加 `getTypeStats, hasVocabularyBackend` 与 `getCurrentUser`、`TypeStats`、图标 `Keyboard`。state 增加 `const [typeStats, setTypeStats] = useState<TypeStats | null>(null);`。`loadStats` 里追加：

```ts
    if (hasVocabularyBackend() && getCurrentUser()) {
      try {
        setTypeStats(await getTypeStats());
      } catch {
        setTypeStats(null);
      }
    }
```

- [ ] **Step 3: Stats.tsx 渲染区块**

在“本周趋势” section 之前插入（仅 `hasVocabularyBackend() && getCurrentUser()` 时渲染）：

```tsx
      {hasVocabularyBackend() && getCurrentUser() && (
        <section className="px-5 mb-5">
          <h2 className="font-serif-cn text-lg font-bold text-[var(--ink)] mb-3">
            {t('stats.type.title')}
          </h2>
          <div className="bg-[var(--card)] rounded-2xl p-5 shadow-sm space-y-5">
            {typeStats && (typeStats.recent_sessions.length > 0 || typeStats.daily_trend.length > 0) ? (
              <>
                {typeStats.daily_trend.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--ink-light)] mb-2">{t('stats.type.trend')}</p>
                    <div className="flex items-end justify-between gap-2 h-24">
                      {typeStats.daily_trend.map((day) => (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] text-[var(--ink-light)]">
                            {Math.round(day.avg_accuracy * 100)}%
                          </span>
                          <div
                            className="w-full max-w-[28px] rounded-full bg-[var(--btn-bg)] transition-all duration-500"
                            style={{
                              height: `${Math.max(day.avg_accuracy * 80, 4)}px`,
                            }}
                          />
                          <span className="text-[10px] text-[var(--ink-light)]">{day.date.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs text-[var(--ink-light)] mb-2">{t('stats.type.recent')}</p>
                  <ul className="space-y-2">
                    {typeStats.recent_sessions.slice(0, 10).map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--ink)]">
                          {s.deck_name || t('type.all.cards')}
                          <span className="text-[var(--ink-light)] ml-2">
                            {s.mode === 'word' ? t('type.word.mode') : t('type.sentence.mode')}
                          </span>
                        </span>
                        <span className="text-[var(--ink-light)] tabular-nums">
                          {Math.round(s.avg_accuracy * 100)}% · {Math.round(s.avg_wpm)} WPM · {s.created_at.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--ink-light)] text-center py-4">{t('stats.type.no.data')}</p>
            )}
          </div>
        </section>
      )}
```

- [ ] **Step 4: 验证**

Run: `cd moyan-web && npm run check && npx vitest run`
Expected: 0 errors，全部测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add moyan-web/src/pages/Stats.tsx moyan-web/src/i18n/translations.ts
git commit -m "feat(web): typing practice section on stats page"
```

---

### Task 6: 全量验证与收尾

- [ ] **Step 1: 后端全量测试**

Run: `cd moyan-backend && cargo test 2>&1 | tail -15`
Expected: 全部 PASS（原 50 + 新增 5–6 个）。

- [ ] **Step 2: 前端全量**

Run: `cd moyan-web && npm run check && npm test`
Expected: 0 errors，全部测试 PASS。

- [ ] **Step 3: 重启后端并冒烟**

重启 `moyan-backend`（迁移会自动建表），用已登录 token 调：

```bash
curl -sS -H "Authorization: Bearer <token>" http://127.0.0.1:4323/api/type/stats
```

Expected: `{ "success": true, "data": { "recent_sessions": [], "daily_trend": [], "mastery": [] } }`。

- [ ] **Step 4: 浏览器冒烟（Playwright 临时环境）**

在 `/tmp/moyan-bt.71y0AL`（或复用现有 playwright 脚本）打开 `http://localhost:5000/type`，登录后完成一次 2–3 词训练，退出后到 `/stats` 确认“打字训练”区块出现最近会话；再次进入 `/type` 确认排序不再报错。

- [ ] **Step 5: 收尾 commit**

如有修复则提交；最后 `git log --oneline -6` 展示本次 5 个提交。
