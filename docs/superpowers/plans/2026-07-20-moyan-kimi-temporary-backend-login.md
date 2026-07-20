# Moyan Kimi Temporary Backend Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Kimi device authorization through the backend and issue a Moyan JWT only after the backend obtains a stable Kimi user identifier.

**Architecture:** The backend stores short-lived opaque login sessions in application state. It alone calls Kimi's device, token, and userinfo endpoints; the browser polls the backend with the opaque login ID, then receives only the existing `AuthResponse`. Sync remains isolated by the internal user ID in the Moyan JWT.

**Tech Stack:** Rust, Axum, Reqwest, Tokio, React 19, TypeScript, Vitest.

## Global Constraints

- Do not return Kimi `device_code` or access tokens to the browser.
- Only a backend-obtained token plus a non-empty Kimi `sub` or `id` may create a Kimi user and mint a Moyan JWT.
- Expired, unknown, and consumed login sessions must be rejected.
- Preserve existing Google login and authenticated sync API contracts.
- Kimi upstream details remain a temporary integration and must be isolated behind the backend session flow.

---

### Task 1: Backend authorization-session service

**Files:**
- Create: `moyan-backend/src/services/kimi_auth.rs`
- Modify: `moyan-backend/src/services/mod.rs`
- Modify: `moyan-backend/src/middleware/error.rs`
- Test: `moyan-backend/src/services/kimi_auth.rs`

**Interfaces:**
- Produces: `KimiAuthService::start_device_login()`, `KimiAuthService::poll_login(login_id)`, `KimiLoginStart`, and `KimiLoginPoll`.
- Consumes: Kimi upstream endpoints `device_authorization`, `token`, and `userinfo`.

- [ ] **Step 1: Write the failing unit tests**

Add tests proving that an unknown login ID is rejected, a pending poll does not emit a token, and a success consumes the session.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cargo test kimi_auth --lib`

Expected: FAIL because `KimiAuthService` does not exist.

- [ ] **Step 3: Implement the minimal session service**

Use `Arc<Mutex<HashMap<String, PendingLogin>>>`; create opaque UUID `login_id` values, reject expired/unknown IDs, call Kimi only from the service, and delete a session once token exchange succeeds or becomes terminal. Use userinfo to require `sub` or `id` before returning identity data.

- [ ] **Step 4: Run focused tests**

Run: `cargo test kimi_auth --lib`

Expected: PASS.

### Task 2: Backend routes and internal JWT issuance

**Files:**
- Modify: `moyan-backend/src/controllers/auth.rs`
- Modify: `moyan-backend/src/routes/auth.rs`
- Modify: `moyan-backend/src/main.rs`
- Test: `moyan-backend/src/controllers/auth.rs`

**Interfaces:**
- Consumes: `KimiAuthService::start_device_login()` and `poll_login(login_id)`.
- Produces: `POST /api/auth/kimi/device` returning `login_id`, URL, expiry and interval; `POST /api/auth/kimi/token` accepting `{ login_id }`, returning pending or existing `AuthResponse`.

- [ ] **Step 1: Write the failing controller tests**

Test that the device endpoint response exposes no `device_code`, and that a successful identity becomes `provider = "kimi"` via `find_or_create_user` before `generate_jwt` is called.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cargo test auth --lib`

Expected: FAIL because the new route contract is absent.

- [ ] **Step 3: Implement controllers and route contract**

Inject `KimiAuthService` into `AppState`; replace the current client-token login handler. Map pending state to a JSON response without JWT, and map verified identity to `find_or_create_user("kimi", provider_id, ...)` plus `AuthResponse`.

- [ ] **Step 4: Run backend tests and type checks**

Run: `cargo test --locked && cargo check --locked`

Expected: PASS.

### Task 3: Frontend backend-only Kimi polling

**Files:**
- Modify: `moyan-web/src/services/authService.ts`
- Test: `moyan-web/src/services/authService.test.ts`

**Interfaces:**
- Consumes: `VITE_API_URL`, `/api/auth/kimi/device`, and `/api/auth/kimi/token`.
- Produces: `loginWithKimi(onWaiting, onPolling): Promise<User>` storing only the Moyan JWT under `moyan_token`.

- [ ] **Step 1: Write the failing Vitest cases**

Mock `fetch` to prove the client opens the returned verification URL, polls with `login_id` only, continues on pending, and stores the returned Moyan JWT without receiving or persisting a Kimi token.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/services/authService.test.ts`

Expected: FAIL because the client still calls Kimi directly.

- [ ] **Step 3: Implement the frontend contract**

Require `VITE_API_URL` for Kimi login, request the backend device endpoint, poll the backend endpoint with `login_id`, and preserve the existing success shape (`data.data.token`, `data.data.user`). Remove frontend direct calls to Kimi device/token/userinfo endpoints and browser storage of Kimi credentials.

- [ ] **Step 4: Run frontend tests and checks**

Run: `npm test -- src/services/authService.test.ts && npm run check && npm run build`

Expected: PASS.

### Task 4: Regression verification and documentation

**Files:**
- Modify: `docs/moyan-business-logic.md`
- Modify: `moyan-backend/README.md`

**Interfaces:**
- Documents: backend-only Kimi Device Flow and its temporary upstream dependency.

- [ ] **Step 1: Update documentation**

Document that Kimi access tokens never reach the browser, while Moyan JWT authenticates sync endpoints and carries the internal user ID.

- [ ] **Step 2: Run full validation**

Run: `cargo test --locked && cargo check --locked` in `moyan-backend`, then `npm test && npm run check && npm run build` in `moyan-web`, followed by `git diff --check` at repository root.

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add moyan-backend moyan-web docs/moyan-business-logic.md docs/superpowers/plans/2026-07-20-moyan-kimi-temporary-backend-login.md
git commit -m "feat: proxy Kimi device login through backend"
```
