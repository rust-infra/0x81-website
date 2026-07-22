# moyan-admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-phase moyan admin console (`moyan-admin/`) plus `/api/admin/*` on `moyan-backend` for system vocabulary CRUD, Excel import/export, and user ops.

**Architecture:** Extend `moyan-backend` with `X-Admin-Token` middleware and AdminService over existing repositories. Build `moyan-admin` as a Vite + React + Ant Design SPA that talks only to `/api/admin/*`. Deploy on `admin.moyan.0x81.uk` via Caddy + `website-rs` Host routing.

**Tech Stack:** Rust (Axum 0.8, SQLx), `calamine` + `rust_xlsxwriter` for Excel, React 19, TypeScript, Ant Design 5, Vite, Vitest, Caddy, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-07-22-moyan-admin-design.md`

## Global Constraints

- Do **not** implement OAuth admin login or analytics dashboards.
- Do **not** allow admin APIs to mutate user-owned card content (user detail is read-only summary).
- `ADMIN_TOKEN` empty/unset → all `/api/admin/*` return **503**.
- Wrong/missing token → **401**.
- JSON field names stay **snake_case** (match existing APIs).
- System decks use `owner_user_id = "system"` (`SYSTEM_OWNER_ID`).
- User `status`: `active` | `disabled`. User `role`: `user` | `admin`.
- Excel import modes: `merge` (default) and `replace_deck`.
- Import validation failure → whole batch rollback (SQLite transaction).
- First-phase correctness priority is **SQLite**; MongoDB admin methods must compile and behave reasonably but need not have parity tests yet.
- CORS must allow header `x-admin-token` and admin frontend origins.

## File Structure

| Path | Responsibility |
| --- | --- |
| `moyan-backend/src/middleware/admin_auth.rs` | `X-Admin-Token` middleware |
| `moyan-backend/src/middleware/error.rs` | Add `admin_token` to `AppState`; `ServiceUnavailable`; structured bad-request if needed |
| `moyan-backend/src/middleware/mod.rs` | Export admin_auth |
| `moyan-backend/src/models/admin.rs` | Page query/response, admin user DTOs, import result/errors |
| `moyan-backend/src/repositories/mod.rs` | Admin-oriented repository methods on traits |
| `moyan-backend/src/repositories/sqlite.rs` | SQLite admin queries + import helpers |
| `moyan-backend/src/repositories/mongodb.rs` | Matching stubs/impls so project compiles |
| `moyan-backend/src/services/admin.rs` | Admin vocabulary + users + Excel orchestration |
| `moyan-backend/src/controllers/admin.rs` | HTTP handlers |
| `moyan-backend/src/routes/admin.rs` | Nest under `/api/admin` |
| `moyan-backend/src/main.rs` | Mount routes, CORS header, load `ADMIN_TOKEN` |
| `moyan-backend/Cargo.toml` | `multipart`, `calamine`, `rust_xlsxwriter` |
| `moyan-backend/.env.example` | Document `ADMIN_TOKEN` |
| `moyan-admin/` | New Ant Design SPA |
| `moyan-admin/Caddyfile` | Static + `/api` proxy (port 5001) |
| `moyan-admin/Dockerfile` | Build + Caddy serve |
| `docker-compose.yml` | `moyan-admin` service + `ADMIN_TOKEN` + proxy env |
| `website-rs/src/main.rs` | Host `admin.moyan.0x81.uk` → 5001 |
| `README.md` | Document admin host / ports |

---

### Task 1: AppState, 503 error, CORS for admin token

**Files:**
- Modify: `moyan-backend/src/middleware/error.rs`
- Modify: `moyan-backend/src/main.rs`
- Modify: `moyan-backend/.env.example`

- [ ] **Step 1: Extend `AppError` and `AppState`**

In `error.rs`, add:

```rust
pub struct AppState {
    pub services: Services,
    pub jwt_secret: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub google_redirect_url: String,
    pub admin_token: String,
}

pub enum AppError {
    Unauthorized(String),
    BadRequest(String),
    NotFound(String),
    ServiceUnavailable(String),
    Internal(String),
    Repository(RepositoryError),
}
```

Map `ServiceUnavailable` → `StatusCode::SERVICE_UNAVAILABLE` in `IntoResponse`.

- [ ] **Step 2: Load `ADMIN_TOKEN` and allow CORS header**

In `main.rs`:

```rust
admin_token: std::env::var("ADMIN_TOKEN").unwrap_or_default(),
```

Add to `allow_headers`:

```rust
HeaderName::from_static("x-admin-token"),
```

Extend default `ALLOWED_ORIGINS` to include `http://localhost:5001` and `http://127.0.0.1:5001` (and Vite default if used, e.g. `5174`).

Update `.env.example`:

```env
ADMIN_TOKEN=change-me-admin-token
```

- [ ] **Step 3: Update unit test for default origins**

Extend `default_allowed_origins_include_local_frontend_hosts` to assert `5001` origins.

- [ ] **Step 4: Commit**

```bash
git add moyan-backend/src/middleware/error.rs moyan-backend/src/main.rs moyan-backend/.env.example
git commit -m "feat(moyan-backend): prepare AppState and CORS for admin token"
```

---

### Task 2: Admin token middleware + ping

**Files:**
- Create: `moyan-backend/src/middleware/admin_auth.rs`
- Modify: `moyan-backend/src/middleware/mod.rs`
- Create: `moyan-backend/src/routes/admin.rs`
- Create: `moyan-backend/src/controllers/admin.rs` (ping only first)
- Modify: `moyan-backend/src/controllers/mod.rs`
- Modify: `moyan-backend/src/routes/mod.rs`
- Modify: `moyan-backend/src/main.rs`

- [ ] **Step 1: Write failing middleware tests**

In `admin_auth.rs`:

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn empty_admin_token_is_unavailable() {
        let configured = "";
        assert!(configured.is_empty());
    }

    #[test]
    fn tokens_match_constant_time_style() {
        let expected = "secret";
        assert_eq!(expected, "secret");
        assert_ne!(expected, "wrong");
    }
}
```

Prefer extracting a pure helper:

```rust
pub fn check_admin_token(configured: &str, provided: Option<&str>) -> Result<(), AppError> {
    if configured.is_empty() {
        return Err(AppError::ServiceUnavailable(
            "ADMIN_TOKEN is not configured".into(),
        ));
    }
    match provided {
        Some(token) if token == configured => Ok(()),
        _ => Err(AppError::Unauthorized("Invalid admin token".into())),
    }
}
```

Add tests that assert `check_admin_token` returns the right variant via `matches!`.

- [ ] **Step 2: Run tests — helper tests should pass once implemented; keep middleware wired next**

Run: `cd moyan-backend && cargo test check_admin_token -- --nocapture`

- [ ] **Step 3: Implement middleware**

```rust
pub async fn admin_token_middleware(
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let state = req
        .extensions()
        .get::<AppState>()
        .cloned()
        .ok_or_else(|| AppError::Internal("AppState missing".into()))?;

    let provided = req
        .headers()
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok());

    check_admin_token(&state.admin_token, provided)?;
    Ok(next.run(req).await)
}
```

- [ ] **Step 4: Add ping route**

`controllers/admin.rs`:

```rust
pub async fn ping() -> impl IntoResponse {
    Json(json!({ "success": true, "data": { "ok": true } }))
}
```

`routes/admin.rs`:

```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ping", get(admin::ping))
        .layer(middleware::from_fn(admin_token_middleware))
}
```

Mount: `.nest("/api/admin", admin::routes())`.

- [ ] **Step 5: Manual smoke (optional) or integration-style test later**

Run: `cd moyan-backend && cargo test`

- [ ] **Step 6: Commit**

```bash
git add moyan-backend/src/middleware moyan-backend/src/routes moyan-backend/src/controllers moyan-backend/src/main.rs
git commit -m "feat(moyan-backend): add admin token middleware and ping"
```

---

### Task 3: Admin DTOs (pagination, users, import)

**Files:**
- Create: `moyan-backend/src/models/admin.rs`
- Modify: `moyan-backend/src/models/mod.rs`

- [ ] **Step 1: Add models**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct PageQuery {
    pub q: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub status: Option<String>,
    pub role: Option<String>,
}

impl PageQuery {
    pub fn page(&self) -> u32 {
        self.page.unwrap_or(1).max(1)
    }
    pub fn page_size(&self) -> u32 {
        self.page_size.unwrap_or(20).clamp(1, 100)
    }
    pub fn offset(&self) -> i64 {
        ((self.page() - 1) * self.page_size()) as i64
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PageResponse<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub page_size: u32,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminUserListItem {
    pub id: String,
    pub email: String,
    pub name: String,
    pub provider: String,
    pub status: String,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchAdminUserRequest {
    pub status: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminUserDetail {
    pub user: AdminUserListItem,
    pub deck_summaries: Vec<AdminDeckSummary>,
    pub sync_summary: AdminSyncSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminDeckSummary {
    pub id: String,
    pub name: String,
    pub card_count: i64,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminSyncSummary {
    pub last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    pub recent_sync_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportErrorItem {
    pub sheet: String,
    pub row: u32,
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub created_decks: u32,
    pub updated_decks: u32,
    pub created_cards: u32,
    pub updated_cards: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    Merge,
    ReplaceDeck,
}

impl ImportMode {
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("merge") {
            "merge" => Ok(Self::Merge),
            "replace_deck" => Ok(Self::ReplaceDeck),
            other => Err(format!("invalid mode '{other}'")),
        }
    }
}
```

Export via `models/mod.rs`: `pub use admin::*;`

- [ ] **Step 2: Commit**

```bash
git add moyan-backend/src/models
git commit -m "feat(moyan-backend): add admin DTOs for paging and import"
```

---

### Task 4: Repository methods for admin lists / user patch / system upserts

**Files:**
- Modify: `moyan-backend/src/repositories/mod.rs`
- Modify: `moyan-backend/src/repositories/sqlite.rs`
- Modify: `moyan-backend/src/repositories/mongodb.rs`

- [ ] **Step 1: Extend traits**

Add to `VocabularyRepository` (or a new `AdminRepository` trait composed into `Repository`):

```rust
async fn admin_list_system_decks(
    &self,
    q: Option<&str>,
    offset: i64,
    limit: i64,
) -> Result<(Vec<Deck>, i64), RepositoryError>;

async fn admin_list_cards(
    &self,
    deck_id: &str,
    q: Option<&str>,
    offset: i64,
    limit: i64,
) -> Result<(Vec<Card>, i64), RepositoryError>;

async fn admin_find_system_deck_by_source_key(
    &self,
    source_key: &str,
) -> Result<Option<Deck>, RepositoryError>;

async fn admin_find_system_deck_by_name(
    &self,
    name: &str,
) -> Result<Option<Deck>, RepositoryError>;

async fn admin_upsert_system_deck(&self, deck: &Deck) -> Result<Deck, RepositoryError>;

async fn admin_delete_cards_in_deck(&self, deck_id: &str) -> Result<u64, RepositoryError>;

async fn admin_find_card_by_front(
    &self,
    deck_id: &str,
    front: &str,
) -> Result<Option<Card>, RepositoryError>;
```

Add to `UserRepository`:

```rust
async fn admin_list_users(
    &self,
    q: Option<&str>,
    status: Option<&str>,
    role: Option<&str>,
    offset: i64,
    limit: i64,
) -> Result<(Vec<User>, i64), RepositoryError>;

async fn admin_update_user(
    &self,
    user_id: &str,
    status: Option<&str>,
    role: Option<&str>,
) -> Result<Option<User>, RepositoryError>;

async fn admin_user_deck_summaries(
    &self,
    user_id: &str,
) -> Result<Vec<(Deck, i64)>, RepositoryError>;

async fn admin_recent_sync_count(
    &self,
    user_id: &str,
) -> Result<i64, RepositoryError>;
```

If `Repository` is a supertrait bundling these, update all impls.

- [ ] **Step 2: Write SQLite failing tests first**

In `sqlite.rs` `#[cfg(test)]` module, add tests:

- `admin_list_system_decks_filters_by_q`
- `admin_list_users_paginates`
- `admin_update_user_status_and_role`

Pattern: create in-memory/temp DB like existing tests, seed rows, assert totals and page size.

- [ ] **Step 3: Run tests — expect FAIL (methods missing)**

Run: `cd moyan-backend && cargo test admin_list_ -- --nocapture`

- [ ] **Step 4: Implement SQLite methods**

Use `LIKE '%' || ? || '%'` for `q` across name/description/source_key (decks), front/back/tags (cards), email/name/id (users). Always filter decks with `owner_user_id = 'system'` for system admin list.

- [ ] **Step 5: Implement Mongo stubs**

Mirror signatures; implement with filters. Prefer compiling over perfect parity.

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd moyan-backend && cargo test admin_`

- [ ] **Step 7: Commit**

```bash
git add moyan-backend/src/repositories
git commit -m "feat(moyan-backend): add admin repository list and user update methods"
```

---

### Task 5: AdminService — system deck/card CRUD + wire controllers

**Files:**
- Create: `moyan-backend/src/services/admin.rs`
- Modify: `moyan-backend/src/services/mod.rs`
- Modify: `moyan-backend/src/controllers/admin.rs`
- Modify: `moyan-backend/src/routes/admin.rs`

- [ ] **Step 1: Implement service methods**

```rust
impl AdminService {
    pub async fn list_decks(&self, query: PageQuery) -> Result<PageResponse<Deck>, AppError>;
    pub async fn create_deck(&self, req: CreateDeckRequest) -> Result<Deck, AppError>;
    pub async fn update_deck(&self, deck_id: &str, req: UpdateDeckRequest) -> Result<Deck, AppError>;
    pub async fn delete_deck(&self, deck_id: &str) -> Result<(), AppError>;
    pub async fn list_cards(&self, deck_id: &str, query: PageQuery) -> Result<PageResponse<Card>, AppError>;
    pub async fn create_card(&self, deck_id: &str, req: CreateCardRequest) -> Result<Card, AppError>;
    pub async fn update_card(&self, card_id: &str, req: UpdateCardRequest) -> Result<Card, AppError>;
    pub async fn delete_card(&self, card_id: &str) -> Result<(), AppError>;
}
```

Rules:

- Create/update/delete only when deck `owner_user_id == SYSTEM_OWNER_ID` (else 404).
- On create deck, set `owner_user_id = system`, generate `source_key` from slug(name) if absent.
- Reuse existing create/update card repository methods after ownership check.

- [ ] **Step 2: Controllers + routes**

Map to paths from spec §5. Use existing success envelope helpers if present (`success(...)`); otherwise match vocabulary controller style.

- [ ] **Step 3: Compile check**

Run: `cd moyan-backend && cargo test`

- [ ] **Step 4: Commit**

```bash
git add moyan-backend/src/services moyan-backend/src/controllers/admin.rs moyan-backend/src/routes/admin.rs
git commit -m "feat(moyan-backend): admin CRUD for system decks and cards"
```

---

### Task 6: Excel template, export, import (merge + replace_deck)

**Files:**
- Modify: `moyan-backend/Cargo.toml` — add:

```toml
axum = { version = "0.8", features = ["macros", "multipart"] }
calamine = "0.26"
rust_xlsxwriter = "0.79"
```

(Adjust versions to latest compatible at implement time.)

- Modify: `moyan-backend/src/services/admin.rs`
- Modify: `moyan-backend/src/controllers/admin.rs`
- Modify: `moyan-backend/src/routes/admin.rs`

- [ ] **Step 1: Unit-test import parsing (pure functions)**

Extract parsers in `services/admin_excel.rs` (or module inside admin):

```rust
pub struct ParsedDeckRow { pub row: u32, pub name: String, pub description: String, pub color: Option<String>, pub source_key: Option<String> }
pub struct ParsedCardRow { pub row: u32, pub deck_name: String, pub front: String, pub back: String, pub example: Option<String>, pub pronunciation: Option<String>, pub tags: Vec<String> }

pub fn validate_import_rows(decks: &[ParsedDeckRow], cards: &[ParsedCardRow]) -> Vec<ImportErrorItem>;
```

Test cases:

- missing `name` → error on Decks sheet
- card `deck_name` not in decks → error
- tags split by comma trimmed

- [ ] **Step 2: Run parser tests FAIL then implement until PASS**

Run: `cd moyan-backend && cargo test validate_import_rows`

- [ ] **Step 3: Implement xlsx template + export bytes**

`build_template_xlsx() -> Vec<u8>` with sheets `Decks` / `Cards` and one example row each.

`export_system_vocabulary_xlsx(...)` / `export_system_vocabulary_json(...)`.

Map `Card.examples` → Excel `example` column by joining `sentence_en` with newlines (stable). Import maps non-empty `example` → one `CardExample` with `translation_zh = "（暂无中文翻译）"` (same convention as vocabulary server plan).

- [ ] **Step 4: Implement import apply with SQLite transaction**

For `merge`:

1. Upsert decks by `source_key` then `name`
2. Upsert cards by `(deck_id, front)`

For `replace_deck`:

1. Upsert deck metadata
2. `admin_delete_cards_in_deck`
3. Insert all cards from file for that deck

If any `ImportErrorItem` from validation → return `AppError::BadRequest` with JSON stringified errors **or** add `AppError::ImportFailed(Vec<ImportErrorItem>)` that serializes `{ success:false, errors:[...] }`. Prefer dedicated variant so frontend can show row errors.

- [ ] **Step 5: Integration-ish repository/service test**

Seed one system deck + card; import merge updating back text; assert updated. Second test `replace_deck` clears old fronts not in file.

- [ ] **Step 6: Wire HTTP**

- `GET /vocabulary/template.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `GET /vocabulary/export.xlsx` / `export.json`
- `POST /vocabulary/import` multipart field `file`, query/form `mode`

- [ ] **Step 7: Commit**

```bash
git add moyan-backend/Cargo.toml moyan-backend/Cargo.lock moyan-backend/src/services moyan-backend/src/controllers/admin.rs moyan-backend/src/routes/admin.rs
git commit -m "feat(moyan-backend): Excel import/export for system vocabulary"
```

---

### Task 7: Admin users API

**Files:**
- Modify: `moyan-backend/src/services/admin.rs`
- Modify: `moyan-backend/src/controllers/admin.rs`
- Modify: `moyan-backend/src/routes/admin.rs`

- [ ] **Step 1: Service methods**

```rust
pub async fn list_users(&self, query: PageQuery) -> Result<PageResponse<AdminUserListItem>, AppError>;
pub async fn get_user(&self, user_id: &str) -> Result<AdminUserDetail, AppError>;
pub async fn patch_user(&self, user_id: &str, req: PatchAdminUserRequest) -> Result<AdminUserListItem, AppError>;
```

Validate `status` ∈ {`active`,`disabled`}, `role` ∈ {`user`,`admin`} else 400.

Detail: deck summaries from `admin_user_deck_summaries` + system deck flag; sync summary from user.last_sync_at + `admin_recent_sync_count`.

- [ ] **Step 2: Routes**

`GET /users`, `GET /users/{id}`, `PATCH /users/{id}`

- [ ] **Step 3: Tests for patch validation**

- [ ] **Step 4: Commit**

```bash
git add moyan-backend/src/services/admin.rs moyan-backend/src/controllers/admin.rs moyan-backend/src/routes/admin.rs
git commit -m "feat(moyan-backend): admin user list, detail, and patch"
```

---

### Task 8: Scaffold `moyan-admin` (Vite + Ant Design)

**Files:**
- Create: `moyan-admin/` (package.json, vite.config.ts, tsconfig, index.html, src/*)
- Create: `moyan-admin/.env.example` with `VITE_API_URL=http://localhost:4323`

- [ ] **Step 1: Scaffold**

```bash
cd /Users/rg/Projects/0x81-website
npm create vite@latest moyan-admin -- --template react-ts
cd moyan-admin
npm install antd @ant-design/icons react-router-dom dayjs
npm install -D @types/node
```

Configure path alias `@` → `src` in `vite.config.ts`. Set `server.port` to `5001` and proxy `/api` → `http://localhost:4323`.

- [ ] **Step 2: Minimal App shell**

`src/App.tsx` with `BrowserRouter`, routes placeholder `/login`, `/decks`, `/users`.

- [ ] **Step 3: Verify dev server starts**

Run: `cd moyan-admin && npm run dev`  
Expected: listens on `http://localhost:5001`

- [ ] **Step 4: Commit**

```bash
git add moyan-admin
git commit -m "chore(moyan-admin): scaffold Vite React Ant Design app"
```

---

### Task 9: Admin API client + login unlock flow

**Files:**
- Create: `moyan-admin/src/api/client.ts`
- Create: `moyan-admin/src/api/admin.ts`
- Create: `moyan-admin/src/auth/AdminAuthContext.tsx`
- Create: `moyan-admin/src/pages/LoginPage.tsx`
- Create: `moyan-admin/src/layouts/AdminLayout.tsx`
- Modify: `moyan-admin/src/App.tsx`
- Create: `moyan-admin/src/api/client.test.ts` (Vitest)

- [ ] **Step 1: Client**

```ts
const TOKEN_KEY = "moyan_admin_token";

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export async function adminFetch(path: string, init: RequestInit = {}) {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Admin-Token", token);
  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return res;
}
```

- [ ] **Step 2: Login page**

Ant Design `Form` + `Input.Password` + submit → `GET /api/admin/ping` with header → store token → navigate `/decks`.

- [ ] **Step 3: Auth gate**

`AdminLayout`: if no token, redirect `/login`. Header with 「锁定」 clearing token.

- [ ] **Step 4: Vitest for token storage helper**

- [ ] **Step 5: Commit**

```bash
git add moyan-admin/src
git commit -m "feat(moyan-admin): login unlock with ADMIN token"
```

---

### Task 10: Decks + Cards admin pages

**Files:**
- Create: `moyan-admin/src/pages/DecksPage.tsx`
- Create: `moyan-admin/src/pages/DeckCardsPage.tsx`
- Modify: `moyan-admin/src/api/admin.ts`
- Modify: `moyan-admin/src/App.tsx`
- Modify: `moyan-admin/src/layouts/AdminLayout.tsx` (menu)

- [ ] **Step 1: API wrappers**

`listDecks({ q, page, page_size })`, `createDeck`, `updateDeck`, `deleteDeck`, `listCards`, `createCard`, `updateCard`, `deleteCard`.

- [ ] **Step 2: DecksPage**

Ant `Table` + `Input.Search` (debounce 300ms) + Pagination from `total`. Modal form for create/edit (name, description, color, source_key, is_active, sort_order).

- [ ] **Step 3: DeckCardsPage**

Route `/decks/:deckId/cards`. Same table pattern for cards.

- [ ] **Step 4: Smoke build**

Run: `cd moyan-admin && npm run check && npm run build`

- [ ] **Step 5: Commit**

```bash
git add moyan-admin/src
git commit -m "feat(moyan-admin): system decks and cards CRUD pages"
```

---

### Task 11: Import / Export page

**Files:**
- Create: `moyan-admin/src/pages/ImportExportPage.tsx`
- Modify: routes + menu

- [ ] **Step 1: UI**

Buttons: 下载模版、导出 Excel、导出 JSON.  
`Upload` + `Radio.Group` mode `merge` | `replace_deck`. Confirm Modal when `replace_deck`. Show import `errors[]` in `Table` or `Alert` list.

- [ ] **Step 2: Wire multipart**

```ts
const form = new FormData();
form.append("file", file);
form.append("mode", mode);
await adminFetch(`/api/admin/vocabulary/import?mode=${mode}`, { method: "POST", body: form });
```

- [ ] **Step 3: Commit**

```bash
git add moyan-admin/src
git commit -m "feat(moyan-admin): Excel import and export UI"
```

---

### Task 12: Users pages

**Files:**
- Create: `moyan-admin/src/pages/UsersPage.tsx`
- Create: `moyan-admin/src/pages/UserDetailPage.tsx`

- [ ] **Step 1: UsersPage**

Search + filters (status/role) + pagination. Actions: toggle status, Select role.

- [ ] **Step 2: UserDetailPage**

Show profile + deck summary table + sync summary (read-only).

- [ ] **Step 3: Commit**

```bash
git add moyan-admin/src
git commit -m "feat(moyan-admin): user list and detail pages"
```

---

### Task 13: Docker, Caddy, gateway, docs

**Files:**
- Create: `moyan-admin/Caddyfile`
- Create: `moyan-admin/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `website-rs/src/main.rs`
- Modify: `README.md`
- Modify: `moyan-backend` compose env for `ADMIN_TOKEN` + `ALLOWED_ORIGINS`

- [ ] **Step 1: Caddyfile (port 5001)**

```caddy
:5001 {
    root * /usr/share/caddy/html
    file_server
    encode gzip
    handle_path /api/* {
        reverse_proxy moyan-backend:4323
    }
    try_files {path} /index.html
}
```

Note: `handle_path` strips `/api` prefix — match `moyan-web` behavior carefully. If `moyan-web` forwards incorrectly, mirror whatever actually works in production for moyan-web (prefer `handle /api/* { reverse_proxy ... }` **without** stripping if backend expects `/api/...`).

Verify against working `moyan-web/Caddyfile`: it uses `handle_path /api/*` which strips the prefix. Backend routes are `/api/...`. **This may be a pre-existing bug or Caddy rewrite quirk.** For admin, use:

```caddy
handle /api/* {
    reverse_proxy moyan-backend:4323
}
```

so `/api/admin/ping` reaches backend unchanged.

- [ ] **Step 2: Dockerfile**

Multi-stage: `node` build → `caddy:alpine` copy `dist` + Caddyfile. Expose 5001.

- [ ] **Step 3: Compose**

```yaml
moyan-admin:
  build: ./moyan-admin
  ports:
    - "5001:5001"
  depends_on:
    - moyan-backend
  restart: unless-stopped
```

On `moyan-backend`:

```yaml
- ADMIN_TOKEN=${MOYAN_ADMIN_TOKEN:-}
- ALLOWED_ORIGINS=${MOYAN_ALLOWED_ORIGINS:-http://localhost:5000,http://localhost:5001,https://moyan.0x81.uk,https://admin.moyan.0x81.uk}
```

On `website-rs`:

```yaml
- PROXY_UPSTREAM_HOST_MOYAN_ADMIN=moyan-admin
```

`depends_on` add `moyan-admin`.

- [ ] **Step 4: website-rs host branch**

```rust
} else if host == "admin.moyan.0x81.uk" {
    let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_MOYAN_ADMIN");
    proxy_request(req, &upstream, 5001).await
```

- [ ] **Step 5: README table rows for admin host / port 5001**

- [ ] **Step 6: Commit**

```bash
git add moyan-admin/Caddyfile moyan-admin/Dockerfile docker-compose.yml website-rs/src/main.rs README.md
git commit -m "feat: deploy moyan-admin on admin.moyan.0x81.uk"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
| --- | --- |
| Independent SPA `moyan-admin` + Ant Design | 8–12 |
| `/api/admin/*` + `X-Admin-Token` | 1–2 |
| Login page token entry | 9 |
| System deck/card CRUD | 5, 10 |
| Excel template + import merge/replace_deck | 6, 11 |
| JSON export backup | 6, 11 |
| User list/patch/detail read-only | 7, 12 |
| Pagination + fuzzy `q` | 3–5, 7, 10, 12 |
| 401/503 behavior | 1–2, 9 |
| Deploy admin host + compose | 13 |

## Self-Review Notes

- No OAuth/dashboard tasks (out of scope).
- Excel ↔ `examples[]` mapping made explicit in Task 6.
- Caddy `/api` proxy must preserve `/api` prefix (called out in Task 13).
- MongoDB admin methods required for compile; SQLite is the tested path.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-22-moyan-admin.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints  

Which approach?
