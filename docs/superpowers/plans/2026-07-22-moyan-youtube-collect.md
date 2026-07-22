# moyan YouTube Collect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can paste a YouTube URL, fetch captions, LLM-extract vocabulary drafts, preview/edit, and import into system decks; LLM credentials are configured in Admin Settings.

**Architecture:** Extend `moyan-backend` admin API (settings KV + collect captions/extract/import). `moyan-admin` adds Collect + Settings pages. Captions via `yt-dlp` subprocess; LLM via OpenAI-compatible HTTP using DB-stored config.

**Tech Stack:** Rust/Axum/SQLx, React/Vite/Ant Design, yt-dlp, reqwest

**Spec:** `docs/superpowers/specs/2026-07-22-moyan-youtube-collect-design.md`

**E2E test video:** https://www.youtube.com/watch?v=LqG1q5NpOBE

---

## File map

| Path | Role |
|------|------|
| `moyan-backend/migrations/004_admin_settings.sql` | `admin_settings` table |
| `moyan-backend/src/models/admin_collect.rs` | DTOs for settings + collect |
| `moyan-backend/src/services/admin_collect.rs` | yt-dlp, VTT clean, LLM, import orchestration |
| `moyan-backend/src/services/youtube_captions.rs` | URL parse + yt-dlp + VTT |
| `moyan-backend/src/services/llm_client.rs` | OpenAI-compatible chat + JSON parse |
| `moyan-backend/src/controllers/admin.rs` | New handlers |
| `moyan-backend/src/routes/admin.rs` | New routes |
| `moyan-backend/src/repositories/{mod,sqlite,mongodb}.rs` | settings get/set |
| `moyan-backend/Dockerfile` | install yt-dlp |
| `moyan-admin/src/pages/{CollectPage,SettingsPage}.tsx` | UI |
| `moyan-admin/src/api/admin.ts` | API client |
| `moyan-admin/src/{App,layouts/AdminLayout}.tsx` | routes + menu |

---

### Task 1: Migration + repository settings KV

**Files:**
- Create: `moyan-backend/migrations/004_admin_settings.sql`
- Modify: `moyan-backend/src/repositories/mod.rs`, `sqlite.rs`, `mongodb.rs`

- [ ] **Step 1:** Add migration

```sql
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2:** Add trait methods

```rust
async fn admin_get_setting(&self, key: &str) -> Result<Option<String>, RepositoryError>;
async fn admin_put_setting(&self, key: &str, value: &str) -> Result<(), RepositoryError>;
```

Implement in SQLite; Mongo: collection `admin_settings` or return Persistence unsupported with clear error if unused in prod.

- [ ] **Step 3:** Commit `feat(moyan): add admin_settings KV migration`

---

### Task 2: Models + LLM settings API

**Files:**
- Create: `moyan-backend/src/models/admin_collect.rs`
- Modify: `moyan-backend/src/models/mod.rs`, `controllers/admin.rs`, `routes/admin.rs`, `services/admin.rs` or new `admin_settings.rs`

- [ ] **Step 1:** DTOs `LlmSettingsPublic`, `UpdateLlmSettingsRequest`, mask helper
- [ ] **Step 2:** `GET/PUT /api/admin/settings/llm` — store JSON under key `llm`
- [ ] **Step 3:** Unit test mask + round-trip put/get (sqlite test)
- [ ] **Step 4:** Commit

---

### Task 3: YouTube captions via yt-dlp

**Files:**
- Create: `moyan-backend/src/services/youtube_captions.rs`
- Test fixtures: sample `.vtt` string in unit test

- [ ] **Step 1:** `parse_youtube_video_id(url) -> Result<String>`
- [ ] **Step 2:** `strip_vtt(text) -> String`
- [ ] **Step 3:** `fetch_captions(url) -> YoutubeCaptions` spawning `MOYAN_YTDLP_PATH` or `yt-dlp` into temp dir, prefer en subs
- [ ] **Step 4:** `POST /api/admin/collect/youtube/captions`
- [ ] **Step 5:** Manual/integration: hit real URL when network allows; else unit tests only
- [ ] **Step 6:** Commit

---

### Task 4: LLM extract + import

**Files:**
- Create: `moyan-backend/src/services/llm_client.rs`, `admin_collect.rs`
- Modify: admin controller/routes, `services/mod.rs`, Dockerfile

- [ ] **Step 1:** `chat_completions` JSON mode / prompt for vocab cards
- [ ] **Step 2:** `POST .../extract` uses DB LLM settings
- [ ] **Step 3:** `POST .../import` create or merge via existing AdminService card APIs
- [ ] **Step 4:** Dockerfile install yt-dlp
- [ ] **Step 5:** Commit

---

### Task 5: Admin frontend Settings + Collect

**Files:**
- Create: `CollectPage.tsx`, `SettingsPage.tsx`
- Modify: `admin.ts`, `App.tsx`, `AdminLayout.tsx`

- [ ] **Step 1:** API client methods
- [ ] **Step 2:** Settings page form
- [ ] **Step 3:** Collect page: steps, timer, preview table, import target
- [ ] **Step 4:** `npm run build`
- [ ] **Step 5:** Commit

---

### Task 6: E2E test

- [ ] Configure LLM in Settings (from env or user key)
- [ ] Collect `https://www.youtube.com/watch?v=LqG1q5NpOBE`
- [ ] Verify progress steps + elapsed time
- [ ] Import → deck cards visible in admin (+ optional moyan-web)
- [ ] Document results / fix failures

---

## Test plan checklist

- [ ] Settings save/load + masked key
- [ ] Captions for LqG1q5NpOBE (or documented network failure)
- [ ] Extract returns draft_cards
- [ ] Import create deck + cards
- [ ] Browser page flow end-to-end
