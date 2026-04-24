# GammaScope Web API Snapshot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Next.js dashboard read the latest FastAPI analytics snapshot when available, while retaining seeded replay as the local/offline fallback.

**Architecture:** Keep data loading server-side for this slice. Add a small tested web helper that fetches `/api/spx/0dte/snapshot/latest` from `GAMMASCOPE_API_BASE_URL` or `http://127.0.0.1:8000`, validates the basic snapshot shape, and falls back to `seedSnapshot` on fetch/HTTP/payload failure. The dashboard page becomes async and uses the helper; frontend polling/WebSockets remain future work.

**Tech Stack:** Next.js App Router server component, TypeScript, Vitest, existing shared `AnalyticsSnapshot` type.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Server-side web helper for loading the latest API snapshot.
- Seeded fallback on API failure or invalid payload.
- Dashboard page uses API-backed snapshot.
- Tests for successful API load and fallback behavior.
- README update for running web + API together.

Out of scope:

- Client polling.
- WebSocket streaming.
- UI controls for API base URL.
- Persisting live state.
- Changing chart/table layout.

## File Structure

- Create: `apps/web/lib/snapshotSource.ts`
- Create: `apps/web/tests/snapshotSource.test.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `README.md`

## Chunk 1: Snapshot Source Helper

### Task 1: Add API Snapshot Loader

**Files:**

- Create: `apps/web/tests/snapshotSource.test.ts`
- Create: `apps/web/lib/snapshotSource.ts`

- [x] **Step 1: Write failing tests**

Add tests that:

- call `loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })` and assert it requests `http://testserver/api/spx/0dte/snapshot/latest`.
- assert a successful API response returns the API snapshot.
- assert fetch rejection falls back to `seedSnapshot`.
- assert non-OK HTTP responses fall back to `seedSnapshot`.
- assert payloads without `schema_version: "1.0.0"` fall back to `seedSnapshot`.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- snapshotSource.test.ts
```

Expected: import failure because `snapshotSource.ts` does not exist yet.

- [x] **Step 3: Implement helper**

Create `loadDashboardSnapshot(options?)` with:

- default API base from `process.env.GAMMASCOPE_API_BASE_URL ?? "http://127.0.0.1:8000"`.
- injected `fetcher` for tests.
- `cache: "no-store"` and `Accept: application/json`.
- conservative shape guard for `schema_version`, `symbol`, and `rows`.
- fallback to `seedSnapshot` for any failure.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- snapshotSource.test.ts
```

Expected: tests pass.

## Chunk 2: Dashboard Integration

### Task 2: Wire Dashboard Page to API Snapshot

**Files:**

- Modify: `apps/web/app/page.tsx`
- Modify: `README.md`

- [x] **Step 1: Update page data loading**

Make the home page async and replace direct `seedSnapshot` usage with:

```ts
const snapshot = await loadDashboardSnapshot();
```

Use `AnalyticsSnapshot["rows"][number]` for row prop typing instead of `typeof seedSnapshot`.

- [x] **Step 2: Update README**

Document local live dashboard testing:

```bash
pnpm dev:api
pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 pnpm dev:web
```

Opening `http://localhost:3000` should show `Live` mode after the mock publish path has populated API state.

- [x] **Step 3: Run web checks**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: typecheck and tests pass.

## Chunk 3: Verification and Commit

### Task 3: Verify Web API Snapshot Slice

**Files:**

- Modify: `docs/superpowers/plans/2026-04-24-gammascope-web-api-snapshot.md`

- [x] **Step 1: Run full checks**

Run:

```bash
pnpm contracts:validate
pnpm test:collector
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
```

Expected: all checks pass.

- [x] **Step 2: Commit web API snapshot slice**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-24-gammascope-web-api-snapshot.md apps/web
git commit -m "feat: load dashboard snapshot from API"
```
