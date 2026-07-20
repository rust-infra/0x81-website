# Moyan Vocabulary Serverization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server the authority for decks, cards, and per-user learning progress, with shared system decks and isolated user decks/progress.

**Architecture:** Add authoritative `decks` / `cards` / `card_progress` tables (plus extended `review_logs` and user fields). Seed system decks once from `vocabulary.json` with `owner_user_id = "system"`. Expose JWT-authenticated user APIs following the settings vertical slice. Frontend switches Decks / DeckDetail / Study from IndexedDB to these APIs; Anki/CSV import is removed. Legacy `/api/sync` and `user_decks` / `user_cards` remain untouched this phase (no dual-write, no old-data migration).

**Tech Stack:** Rust, Axum, SQLx (SQLite), MongoDB driver, React 19, TypeScript, Vitest, existing `uuid` crate.

**Spec:** `docs/superpowers/specs/2026-07-20-moyan-vocabulary-server-design.md`

## Global Constraints

- Do **not** implement `/api/admin/*` in this plan (deferred).
- Do **not** migrate IndexedDB / sync blob data into the new tables.
- Do **not** keep Anki/CSV import UI.
- Client-supplied `owner_user_id` is ignored; always use `claims.sub`.
- Foreign / unauthorized resources return **404**, not 403.
- System decks (`owner_user_id = "system"`) are read-only for normal users.
- JSON field names stay **snake_case** to match existing settings/auth APIs.
- Seed conversion: old `example: string` → `examples: [{ id, sentence_en, translation_zh }]` where `translation_zh` is `"（暂无中文翻译）"` when no Chinese translation exists; skip the entry if `example` is empty/whitespace.
- System `source_key` values are stable slugs (see Task 5); `(owner_user_id, source_key)` unique for system decks.
- ID prefixes: `deck_`, `card_`, `ex_`, `prog_`, `rev_` + `Uuid::new_v4().simple()`.

## File Structure

| Path | Responsibility |
| --- | --- |
| `moyan-backend/migrations/003_vocabulary_server.sql` | New SQLite schema |
| `moyan-backend/src/models/vocabulary.rs` | Deck/Card/Progress/Example/Review DTOs |
| `moyan-backend/src/models/user.rs` | Add status/role/last_login_at/system_decks_initialized_at |
| `moyan-backend/src/repositories/mod.rs` | `VocabularyRepository` trait |
| `moyan-backend/src/repositories/sqlite.rs` | SQLite vocabulary impl |
| `moyan-backend/src/repositories/mongodb.rs` | Mongo vocabulary impl |
| `moyan-backend/src/services/vocabulary.rs` | Authz + business rules |
| `moyan-backend/src/services/system_decks.rs` | Ensure/seed system decks |
| `moyan-backend/src/controllers/vocabulary.rs` | HTTP handlers |
| `moyan-backend/src/routes/vocabulary.rs` | JWT routes under `/api` |
| `moyan-backend/data/system_vocabulary.json` | Copied seed payload (from frontend public file) |
| `moyan-web/src/services/vocabularyApi.ts` | Frontend API client |
| `moyan-web/src/types/vocabulary.ts` | Shared TS types |
| `moyan-web/src/pages/{Decks,DeckDetail,Study,Home}.tsx` | Switch data source |
| `moyan-web/src/services/vocabularyLoader.ts` | Stop seeding IndexedDB when backend mode |

---

### Task 1: Migration and domain models

**Files:**
- Create: `moyan-backend/migrations/003_vocabulary_server.sql`
- Create: `moyan-backend/src/models/vocabulary.rs`
- Modify: `moyan-backend/src/models/mod.rs`
- Modify: `moyan-backend/src/models/user.rs`
- Modify: `moyan-backend/src/models/mod.rs` (`UserResponse` if exposing role later — keep role server-only this phase)

- [ ] **Step 1: Add migration SQL**

```sql
-- 003_vocabulary_server.sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN last_login_at DATETIME;
ALTER TABLE users ADD COLUMN system_decks_initialized_at DATETIME;

CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    source_key TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_system_source
    ON decks(owner_user_id, source_key)
    WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_decks_active_sort ON decks(is_active, sort_order);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    pronunciation TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    examples TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS card_progress (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    srs_status TEXT NOT NULL DEFAULT 'new',
    interval_days REAL NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    due_date DATETIME NOT NULL,
    last_reviewed_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_owner_due
    ON card_progress(owner_user_id, due_date);

-- New review_logs_v2 avoids breaking legacy review_logs FK to user_cards
CREATE TABLE IF NOT EXISTS review_logs_v2 (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    rating TEXT NOT NULL,
    time_ms INTEGER,
    reviewed_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_logs_v2_owner_date
    ON review_logs_v2(owner_user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_v2_deck
    ON review_logs_v2(owner_user_id, deck_id);
```

Note: SQLite `ALTER TABLE ADD COLUMN` is fine for sqlx migrate. Column `interval` is reserved-ish — use `interval_days` in SQL and map to JSON field `interval` in the API model via `#[serde(rename = "interval")]` on a Rust field named `interval` stored from `interval_days`.

- [ ] **Step 2: Add vocabulary models**

Create `moyan-backend/src/models/vocabulary.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const SYSTEM_OWNER_ID: &str = "system";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardExample {
    pub id: String,
    pub sentence_en: String,
    pub translation_zh: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: String,
    pub owner_user_id: String,
    pub source_key: Option<String>,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub version: i32,
    pub sort_order: i32,
    pub is_active: bool,
    pub card_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    pub tags: Vec<String>,
    pub examples: Vec<CardExample>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardProgress {
    pub id: String,
    pub owner_user_id: String,
    pub card_id: String,
    pub srs_status: String,
    pub interval: f64,
    pub repetitions: i32,
    pub ease_factor: f64,
    pub due_date: DateTime<Utc>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyCard {
    pub card: Card,
    pub progress: Option<CardProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewLog {
    pub id: String,
    pub owner_user_id: String,
    pub card_id: String,
    pub deck_id: String,
    pub rating: String,
    pub time_ms: Option<i32>,
    pub reviewed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateDeckRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateDeckRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCardRequest {
    pub front: String,
    pub back: String,
    pub pronunciation: Option<String>,
    pub tags: Option<Vec<String>>,
    pub examples: Option<Vec<CardExampleInput>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateCardRequest {
    pub front: Option<String>,
    pub back: Option<String>,
    pub pronunciation: Option<String>,
    pub tags: Option<Vec<String>>,
    pub examples: Option<Vec<CardExampleInput>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CardExampleInput {
    pub id: Option<String>,
    pub sentence_en: String,
    pub translation_zh: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertCardProgressRequest {
    pub srs_status: String,
    pub interval: f64,
    pub repetitions: i32,
    pub ease_factor: f64,
    pub due_date: DateTime<Utc>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateReviewLogRequest {
    pub card_id: String,
    pub deck_id: String,
    pub rating: String,
    pub time_ms: Option<i32>,
    pub reviewed_at: Option<DateTime<Utc>>,
}
```

Export from `models/mod.rs`. Extend `User` with:

```rust
pub status: String,
pub role: String,
pub last_login_at: Option<DateTime<Utc>>,
pub system_decks_initialized_at: Option<DateTime<Utc>>,
```

Default `status = "active"`, `role = "user"` when reading rows that somehow lack values (Mongo old docs).

- [ ] **Step 3: Compile-check models**

Run: `cd moyan-backend && cargo check --locked`

Expected: PASS (or only fail on unused imports — fix those). Update `UserRow` / Mongo user document mapping in a follow-up task if check fails on repository compile; if so, minimally stub new fields as defaults in row mappers so the crate compiles before Task 2 finishes.

- [ ] **Step 4: Commit**

```bash
git add moyan-backend/migrations/003_vocabulary_server.sql \
  moyan-backend/src/models/vocabulary.rs \
  moyan-backend/src/models/mod.rs \
  moyan-backend/src/models/user.rs
git commit -m "$(cat <<'EOF'
feat(moyan): add vocabulary server schema and domain models

EOF
)"
```

---

### Task 2: VocabularyRepository trait + SQLite implementation

**Files:**
- Modify: `moyan-backend/src/repositories/mod.rs`
- Modify: `moyan-backend/src/repositories/sqlite.rs`
- Test: inline `#[cfg(test)]` in `sqlite.rs`

- [ ] **Step 1: Define the trait**

Add to `repositories/mod.rs`:

```rust
use crate::models::{
    Card, CardExample, CardProgress, CreateCardRequest, CreateDeckRequest, CreateReviewLogRequest,
    Deck, ReviewLog, StudyCard, UpdateCardRequest, UpdateDeckRequest, UpsertCardProgressRequest,
};

#[async_trait]
pub trait VocabularyRepository: Send + Sync {
    async fn list_decks_for_user(&self, user_id: &str) -> Result<Vec<Deck>, RepositoryError>;
    async fn get_deck(&self, deck_id: &str) -> Result<Option<Deck>, RepositoryError>;
    async fn create_user_deck(
        &self,
        user_id: &str,
        req: &CreateDeckRequest,
    ) -> Result<Deck, RepositoryError>;
    async fn update_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
        req: &UpdateDeckRequest,
    ) -> Result<Option<Deck>, RepositoryError>;
    async fn delete_user_deck(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<bool, RepositoryError>;

    async fn list_cards(&self, deck_id: &str) -> Result<Vec<Card>, RepositoryError>;
    async fn get_card(&self, card_id: &str) -> Result<Option<Card>, RepositoryError>;
    async fn create_card(
        &self,
        deck_id: &str,
        req: &CreateCardRequest,
        examples: Vec<CardExample>,
    ) -> Result<Card, RepositoryError>;
    async fn update_card(
        &self,
        card_id: &str,
        req: &UpdateCardRequest,
        examples: Option<Vec<CardExample>>,
    ) -> Result<Option<Card>, RepositoryError>;
    async fn delete_card(&self, card_id: &str) -> Result<bool, RepositoryError>;

    async fn list_study_cards(
        &self,
        user_id: &str,
        deck_id: &str,
    ) -> Result<Vec<StudyCard>, RepositoryError>;
    async fn upsert_card_progress(
        &self,
        user_id: &str,
        card_id: &str,
        req: &UpsertCardProgressRequest,
    ) -> Result<CardProgress, RepositoryError>;
    async fn create_review_log(
        &self,
        user_id: &str,
        req: &CreateReviewLogRequest,
    ) -> Result<ReviewLog, RepositoryError>;

    async fn count_system_decks(&self) -> Result<i64, RepositoryError>;
    async fn insert_system_deck(&self, deck: &Deck) -> Result<(), RepositoryError>;
    async fn insert_system_card(&self, card: &Card) -> Result<(), RepositoryError>;
    async fn mark_system_decks_initialized(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError>;
    async fn get_system_decks_initialized_at(
        &self,
        user_id: &str,
    ) -> Result<Option<DateTime<Utc>>, RepositoryError>;
    async fn touch_last_login(
        &self,
        user_id: &str,
        at: DateTime<Utc>,
    ) -> Result<(), RepositoryError>;
}
```

Extend `Repository` supertrait to include `VocabularyRepository`.

- [ ] **Step 2: Write failing SQLite tests**

```rust
#[tokio::test]
async fn system_and_user_decks_are_listed_together() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    // insert one system deck + one user deck; list for that user returns both active
    Ok(())
}

#[tokio::test]
async fn card_progress_is_isolated_per_user() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    // same card_id, two users, upsert different progress; each list_study_cards sees only own
    Ok(())
}

#[tokio::test]
async fn tags_and_examples_round_trip_as_json_arrays() -> Result<(), RepositoryError> {
    let repo = SqliteRepositories::connect("sqlite::memory:").await?;
    // create card with tags+examples; get_card returns Vec types not strings
    Ok(())
}
```

Fill in real assertions using repository methods once implemented; first run should fail to compile / fail assertions.

- [ ] **Step 3: Run tests to verify failure**

Run: `cd moyan-backend && cargo test system_and_user_decks --lib`

Expected: FAIL (trait/methods missing).

- [ ] **Step 4: Implement SQLite vocabulary methods**

Key behaviors:
- `list_decks_for_user`: `WHERE (owner_user_id = 'system' AND is_active = 1) OR owner_user_id = ?` ordered by `owner_user_id = 'system' DESC`, `sort_order`, `name`.
- `card_count`: subquery `COUNT(*)` from `cards`.
- Serialize `tags` / `examples` with `serde_json::to_string` / `from_str`.
- Map SQL `interval_days` ↔ Rust `CardProgress.interval`.
- `delete_user_deck`: only if `owner_user_id == user_id` (not system); CASCADE deletes cards; return `false` if missing/wrong owner.
- `create_card` / `update_card` / `delete_card` do **not** check ownership (service layer does).
- Update `UserRow` SELECT mappings for new user columns (use `COALESCE` defaults if needed).

- [ ] **Step 5: Run SQLite tests**

Run: `cd moyan-backend && cargo test --lib vocabulary -- --nocapture`  
Also run existing: `cargo test persists_user_learning_data --lib` and `persists_settings_per_user`.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add moyan-backend/src/repositories/mod.rs moyan-backend/src/repositories/sqlite.rs
git commit -m "$(cat <<'EOF'
feat(moyan): implement SQLite vocabulary repository

EOF
)"
```

---

### Task 3: MongoDB VocabularyRepository

**Files:**
- Modify: `moyan-backend/src/repositories/mongodb.rs`

- [ ] **Step 1: Add collections and indexes on connect**

Collections: `decks`, `cards`, `card_progress`, `review_logs_v2`.

Indexes:
- `decks`: unique partial on `(owner_user_id, source_key)` where `source_key` exists
- `decks`: `(owner_user_id)`
- `cards`: `(deck_id)`
- `card_progress`: unique `(owner_user_id, card_id)`; `(owner_user_id, due_date)`
- `review_logs_v2`: `(owner_user_id, reviewed_at)`, `(owner_user_id, deck_id)`

Store `tags` and `examples` as BSON arrays (not strings).

- [ ] **Step 2: Implement the same trait methods** mirroring SQLite semantics (including `card_count` via count documents).

- [ ] **Step 3: Smoke-check compile**

Run: `cd moyan-backend && cargo check --locked`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add moyan-backend/src/repositories/mongodb.rs
git commit -m "$(cat <<'EOF'
feat(moyan): implement MongoDB vocabulary repository

EOF
)"
```

---

### Task 4: Vocabulary service (authz) + HTTP API

**Files:**
- Create: `moyan-backend/src/services/vocabulary.rs`
- Create: `moyan-backend/src/controllers/vocabulary.rs`
- Create: `moyan-backend/src/routes/vocabulary.rs`
- Modify: `moyan-backend/src/services/mod.rs`
- Modify: `moyan-backend/src/controllers/mod.rs`
- Modify: `moyan-backend/src/routes/mod.rs`
- Modify: `moyan-backend/src/main.rs`
- Test: unit tests in `services/vocabulary.rs` for ownership helpers

- [ ] **Step 1: Implement service authz helpers**

```rust
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
```

Writable card ops: load card → load deck → `ensure_user_owns_deck` (system → 404).
Readable card/deck list: system active OR owner.
`upsert_card_progress` / `create_review_log`: verify card exists and deck is readable by user; always stamp `owner_user_id = claims.sub`.
Validate examples: each `sentence_en` and `translation_zh` trim-nonempty; assign `ex_` ids when missing.
Validate deck/card create: non-empty `name` / `front` / `back`.
Valid ratings: `again|hard|good|easy`. Valid `srs_status`: `new|learning|review|relearning`.

- [ ] **Step 2: Wire controllers and routes**

`routes/vocabulary.rs`:

```rust
Router::new()
    .route("/decks", get(list_decks).post(create_deck))
    .route("/decks/{deck_id}", put(update_deck).delete(delete_deck))
    .route("/decks/{deck_id}/cards", get(list_cards).post(create_card))
    .route("/decks/{deck_id}/study-cards", get(list_study_cards))
    .route("/cards/{card_id}", put(update_card).delete(delete_card))
    .route("/card-progress/{card_id}", put(upsert_progress))
    .route("/review-logs", post(create_review_log))
    .layer(middleware::from_fn(jwt_middleware))
```

Mount in `main.rs`: `.nest("/api", routes::vocabulary::routes())` (paths already include `/decks` etc.).

Use `success(data)` responses like settings.

- [ ] **Step 3: Service unit tests for authz**

Test that attempting to update a system deck returns NotFound; updating own deck succeeds path (mock or in-memory sqlite via service+repo).

- [ ] **Step 4: Run tests**

Run: `cd moyan-backend && cargo test --lib && cargo check --locked`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add moyan-backend/src/services/vocabulary.rs \
  moyan-backend/src/controllers/vocabulary.rs \
  moyan-backend/src/routes/vocabulary.rs \
  moyan-backend/src/services/mod.rs \
  moyan-backend/src/controllers/mod.rs \
  moyan-backend/src/routes/mod.rs \
  moyan-backend/src/main.rs
git commit -m "$(cat <<'EOF'
feat(moyan): add authenticated vocabulary HTTP APIs

EOF
)"
```

---

### Task 5: System deck seed + login hook

**Files:**
- Create: `moyan-backend/data/system_vocabulary.json` (copy of `moyan-web/public/vocabulary.json`)
- Create: `moyan-backend/src/services/system_decks.rs`
- Modify: `moyan-backend/src/services/vocabulary.rs` or auth login success path
- Modify: `moyan-backend/src/services/auth.rs` / `controllers/auth.rs` to call ensure on login
- Modify: `moyan-backend/src/services/mod.rs`
- Test: `system_decks` seed idempotency test with tiny fixture JSON in test

**Stable `source_key` map** (fixed; do not derive from localized names at runtime):

| deckIndex | source_key |
| --- | --- |
| 0 | `programming-basics` |
| 1 | `go-core` |
| 2 | `rust-core` |
| 3 | `dsa` |
| 4 | `system-design` |
| 5 | `database-cache` |
| 6 | `network-protocols` |
| 7 | `devops-cloud` |
| 8 | `code-review` |
| 9 | `remote-work` |
| 10 | `tech-interview` |
| 11 | `soft-skills` |
| 12 | `30-day-vocab` |

- [ ] **Step 1: Copy seed file**

```bash
mkdir -p moyan-backend/data
cp moyan-web/public/vocabulary.json moyan-backend/data/system_vocabulary.json
```

- [ ] **Step 2: Implement `SystemDecksService::ensure_available`**

Logic:
1. If `count_system_decks() == 0`, load JSON, insert 13 decks + cards:
   - `owner_user_id = "system"`
   - `is_active = true`
   - `sort_order = deckIndex`
   - `version = 1`
   - card `tags` from JSON array
   - if `example` non-empty → one `CardExample { id: ex_..., sentence_en: example, translation_zh: "（暂无中文翻译）" }`
2. Always (after seed check) if user `system_decks_initialized_at` is `None`, set it to `Utc::now()`.
3. On successful login (Google/Kimi token mint paths), call `touch_last_login` + `ensure_available(user_id)`.

Embed path: prefer `include_str!("../../data/system_vocabulary.json")` for reliability in deploy, **or** read `SYSTEM_VOCABULARY_PATH` env with fallback to `data/system_vocabulary.json`. Prefer `include_str!` so production binary always has the seed.

- [ ] **Step 3: Idempotency test**

```rust
#[tokio::test]
async fn seeding_system_decks_is_idempotent() {
    // ensure twice → still 13 decks, card count unchanged
}
```

- [ ] **Step 4: Run tests**

Run: `cd moyan-backend && cargo test seeding_system_decks --lib`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add moyan-backend/data/system_vocabulary.json \
  moyan-backend/src/services/system_decks.rs \
  moyan-backend/src/services/auth.rs \
  moyan-backend/src/controllers/auth.rs \
  moyan-backend/src/services/mod.rs
git commit -m "$(cat <<'EOF'
feat(moyan): seed system decks and mark user initialization on login

EOF
)"
```

---

### Task 6: Frontend vocabulary API client + types

**Files:**
- Create: `moyan-web/src/types/vocabulary.ts`
- Create: `moyan-web/src/services/vocabularyApi.ts`
- Create: `moyan-web/src/services/vocabularyApi.test.ts`

- [ ] **Step 1: Write failing Vitest**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listDecks, createDeck } from "./vocabularyApi";

describe("vocabularyApi", () => {
  beforeEach(() => {
    localStorage.setItem("moyan_token", "tok");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists decks with bearer token", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });
    await listDecks();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/decks$/),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd moyan-web && npm test -- src/services/vocabularyApi.test.ts`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement client**

Mirror `userSettingsService` patterns (`VITE_API_URL`, Bearer, `{ success, data }`).

Export:
- `hasVocabularyBackend()`
- `listDecks()`, `createDeck()`, `updateDeck()`, `deleteDeck()`
- `listCards(deckId)`, `createCard()`, `updateCard()`, `deleteCard()`
- `listStudyCards(deckId)`
- `upsertCardProgress(cardId, body)`
- `createReviewLog(body)`

Types use snake_case to match API (`sentence_en`, `owner_user_id`, `srs_status`, etc.).

- [ ] **Step 4: Run tests**

Run: `cd moyan-web && npm test -- src/services/vocabularyApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/src/types/vocabulary.ts \
  moyan-web/src/services/vocabularyApi.ts \
  moyan-web/src/services/vocabularyApi.test.ts
git commit -m "$(cat <<'EOF'
feat(moyan-web): add vocabulary API client

EOF
)"
```

---

### Task 7: Decks page — system vs mine, remove import

**Files:**
- Modify: `moyan-web/src/pages/Decks.tsx`
- Modify: `moyan-web/src/i18n/translations.ts` (remove/replace import strings; add system/mine section labels if missing)
- Modify: `moyan-web/src/services/vocabularyLoader.ts` (no-op / skip when backend available)

- [ ] **Step 1: Require auth when backend vocabulary is enabled**

If `hasVocabularyBackend()` and no token, redirect to `/login` (or show login CTA). Do not call `initVocabularyDecks()` in backend mode.

- [ ] **Step 2: Load from API**

```ts
const decks = await listDecks();
const systemDecks = decks.filter((d) => d.owner_user_id === "system");
const myDecks = decks.filter((d) => d.owner_user_id !== "system");
```

Create/delete only call API for my decks. Remove Upload button, `fileInputRef`, `handleImportFile`, `importCSV`, and Anki import imports.

- [ ] **Step 3: Manual/UI check + unit smoke if feasible**

Run: `cd moyan-web && npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add moyan-web/src/pages/Decks.tsx moyan-web/src/i18n/translations.ts moyan-web/src/services/vocabularyLoader.ts
git commit -m "$(cat <<'EOF'
feat(moyan-web): split system/my decks and remove Anki/CSV import

EOF
)"
```

---

### Task 8: DeckDetail — read-only system + examples editor

**Files:**
- Modify: `moyan-web/src/pages/DeckDetail.tsx`

- [ ] **Step 1: Load deck + cards from API**

Resolve `deckId` as string route param. If deck `owner_user_id === "system"`, hide edit/delete/export controls for deck and cards; render cards read-only including `examples` list.

- [ ] **Step 2: User deck examples editor**

Replace single `example` textarea with a list of `{ sentence_en, translation_zh }` rows with add/remove. On save, send `examples` array (server assigns ids if omitted). Validate both fields non-empty before submit.

- [ ] **Step 3: Typecheck**

Run: `cd moyan-web && npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add moyan-web/src/pages/DeckDetail.tsx
git commit -m "$(cat <<'EOF'
feat(moyan-web): read-only system decks and paired examples editor

EOF
)"
```

---

### Task 9: Study flow uses study-cards + progress + review logs

**Files:**
- Modify: `moyan-web/src/pages/Study.tsx`
- Modify: `moyan-web/src/pages/Home.tsx` (due counts from study-cards or keep local only when offline — in backend mode compute from `listStudyCards` across selected deck / all system+user decks as product-appropriate)
- Modify: `moyan-web/src/pages/TypeTraining.tsx` (read `examples[0].sentence_en` instead of `example` when in backend mode)

- [ ] **Step 1: Study load path**

When backend mode + `deck` query:
1. `listStudyCards(deckId)`
2. Build queue from cards; treat missing progress as `new` with due now
3. Keep client-side `calculateSRS` from `services/srs.ts`

- [ ] **Step 2: On rate**

```ts
const next = calculateSRS(currentProgressOrDefault, rating);
await upsertCardProgress(card.id, {
  srs_status: next.status,
  interval: next.interval,
  repetitions: next.repetitions,
  ease_factor: next.easeFactor,
  due_date: next.dueDate.toISOString(),
  last_reviewed_at: new Date().toISOString(),
});
await createReviewLog({
  card_id: card.id,
  deck_id: card.deck_id,
  rating,
  time_ms: elapsed,
});
```

Do **not** write SRS onto card documents.

- [ ] **Step 3: Examples display**

Show `examples` pairs on the back face; speak `sentence_en` when auto-play includes examples.

- [ ] **Step 4: Check + focused tests if any**

Run: `cd moyan-web && npm run check && npm test -- --run`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/src/pages/Study.tsx moyan-web/src/pages/Home.tsx moyan-web/src/pages/TypeTraining.tsx
git commit -m "$(cat <<'EOF'
feat(moyan-web): drive study from server progress APIs

EOF
)"
```

---

### Task 10: End-to-end verification + docs

**Files:**
- Modify: `docs/moyan-business-logic.md` (server-authoritative vocabulary section; note local-only fallback if `VITE_API_URL` empty)
- Optional: `moyan-backend/README.md` note new routes and seed

- [ ] **Step 1: Backend full test**

Run: `cd moyan-backend && cargo test --locked && cargo check --locked`

Expected: PASS.

- [ ] **Step 2: Frontend full check**

Run: `cd moyan-web && npm test -- --run && npm run check && npm run build`

Expected: PASS.

- [ ] **Step 3: Manual acceptance checklist** (against spec)

1. Fresh user login → sees system decks without import.
2. Two users study same system card → independent progress/logs.
3. Normal user cannot mutate system deck/card (API 404 / UI hidden).
4. User A cannot read User B deck (404).
5. Cards store multiple examples with EN+ZH.
6. SQLite and Mongo return array-typed `tags`/`examples` (spot-check with curl against both backends if available).

- [ ] **Step 4: Update business-logic doc briefly**

- [ ] **Step 5: Commit**

```bash
git add docs/moyan-business-logic.md moyan-backend/README.md
git commit -m "$(cat <<'EOF'
docs(moyan): document server-authoritative vocabulary behavior

EOF
)"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
| --- | --- |
| `decks` system + user, `owner_user_id=system` | 1–5 |
| `cards` via `deck_id` only; `examples` JSON | 1–4, 8 |
| `card_progress` per `(owner, card)` | 1–4, 9 |
| `review_logs` with deck + owner | 1–4, 9 (`review_logs_v2`) |
| User fields status/role/lastLogin/systemDecksInitialized | 1, 5 |
| Login ensures system decks; no per-user copy | 5 |
| User APIs listed in spec | 4 |
| Admin APIs | Deferred (explicit) |
| Frontend system/mine split; remove import | 7 |
| System detail read-only; examples editor | 8 |
| Study via study-cards; SRS off card | 9 |
| Acceptance criteria | 10 |
| No Anki/CSV import; no old local migration | 7, Global Constraints |

## Placeholder / Consistency Notes

- Legacy `review_logs` table kept; new writes go to `review_logs_v2` to avoid FK to `user_cards`. API path remains `POST /api/review-logs`.
- SQL column `interval_days` maps to JSON `interval`.
- Offline IndexedDB path: when `VITE_API_URL` is empty, pages may keep existing local behavior; when set, vocabulary is server-authoritative and requires login.
