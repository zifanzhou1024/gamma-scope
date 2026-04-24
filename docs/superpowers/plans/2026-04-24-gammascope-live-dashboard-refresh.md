# GammaScope Live Dashboard Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Subagent implementers MUST use superpowers:test-driven-development for every code change. The controller MUST use superpowers:verification-before-completion before marking a task complete or committing.

**Goal:** Make the Next.js dashboard refresh from the latest API-backed SPX 0DTE analytics snapshot after page load, so local live mock updates can appear without manually reloading the browser.

**Architecture:** Keep the first server render API-backed through `loadDashboardSnapshot()`. Add a web API proxy at the same snapshot path under the Next app so browser code can fetch a relative URL without exposing the FastAPI base URL or needing CORS. Extract the existing dashboard markup into a reusable view component, wrap it in a small client component that refreshes through a non-overlapping polling helper, and keep the seeded fallback behavior owned by the existing server snapshot loader.

**Tech Stack:** Next.js App Router route handler, React client component, TypeScript, Vitest, existing `AnalyticsSnapshot` contract.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Relative web API proxy for `/api/spx/0dte/snapshot/latest`.
- Client-side snapshot fetch helper with injected fetcher tests.
- Reusable dashboard view component using the existing chart/table markup.
- Client refresh shell that refreshes from the relative web API without overlapping in-flight requests.
- Tests for helper behavior, route response behavior, and basic dashboard view rendering.
- README note that the dashboard refreshes live mock snapshots after page load.

Out of scope:

- WebSockets.
- Backend persistence.
- User-configurable refresh cadence.
- Authenticated live mode.
- Visual redesign of the dashboard.

## File Structure

- Create: `apps/web/app/api/spx/0dte/snapshot/latest/route.ts`
- Create: `apps/web/components/DashboardView.tsx`
- Create: `apps/web/components/LiveDashboard.tsx`
- Create: `apps/web/lib/clientSnapshotSource.ts`
- Create: `apps/web/tests/clientSnapshotSource.test.ts`
- Create: `apps/web/tests/snapshotRoute.test.ts`
- Create: `apps/web/tests/DashboardView.test.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/lib/snapshotSource.ts`
- Modify: `README.md`

## Chunk 1: Client Snapshot Source

### Task 1: Add Client Snapshot Fetch Helper

**Files:**

- Create: `apps/web/tests/clientSnapshotSource.test.ts`
- Create: `apps/web/lib/clientSnapshotSource.ts`
- Modify: `apps/web/lib/snapshotSource.ts`

- [x] **Step 1: Write failing tests**

Add tests that:

- call `loadClientDashboardSnapshot({ fetcher })` and assert it requests `/api/spx/0dte/snapshot/latest`.
- assert a valid API response returns an `AnalyticsSnapshot`.
- assert rejected fetches return `null`.
- assert non-OK HTTP responses return `null`.
- assert invalid payloads return `null`.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- clientSnapshotSource.test.ts
```

Expected: import failure because `clientSnapshotSource.ts` does not exist yet.

- [x] **Step 3: Implement helper**

Create `loadClientDashboardSnapshot(options?)` with:

- relative URL `/api/spx/0dte/snapshot/latest`.
- injected fetcher for tests.
- `cache: "no-store"` and `Accept: application/json`.
- validation via the same `isAnalyticsSnapshot` guard exported from `snapshotSource.ts`.
- `null` return for any fetch, HTTP, JSON, or validation failure.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- clientSnapshotSource.test.ts
```

Expected: client snapshot source tests pass.

## Chunk 2: Web Proxy and Dashboard Shell

### Task 2: Add Route and Live Dashboard Components

**Files:**

- Create: `apps/web/app/api/spx/0dte/snapshot/latest/route.ts`
- Create: `apps/web/components/DashboardView.tsx`
- Create: `apps/web/components/LiveDashboard.tsx`
- Create: `apps/web/tests/snapshotRoute.test.ts`
- Create: `apps/web/tests/DashboardView.test.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `README.md`

- [x] **Step 1: Write failing tests**

Add tests that:

- import the route `GET` handler, mock `loadDashboardSnapshot`, and assert it returns JSON with `Cache-Control: no-store`.
- render `DashboardView` to static markup and assert it includes the snapshot mode, session id, spot, and option-chain section.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- snapshotRoute.test.ts DashboardView.test.tsx
```

Expected: failures because the route and dashboard view do not exist yet.

- [x] **Step 3: Implement route and components**

Implement:

- `GET()` route handler that returns `NextResponse.json(await loadDashboardSnapshot())` with `Cache-Control: no-store`.
- `DashboardView` by moving the existing dashboard rendering from `page.tsx` into a snapshot prop component.
- `LiveDashboard` as a `"use client"` shell that stores `initialSnapshot`, uses a tested non-overlapping polling helper, and replaces state when a valid snapshot arrives.
- `page.tsx` as an async server component that loads the initial snapshot and renders `<LiveDashboard initialSnapshot={snapshot} />`.
- README note for live refresh after publishing mock collector updates.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- snapshotRoute.test.ts DashboardView.test.tsx
pnpm typecheck:web
```

Expected: route/view tests and web typecheck pass.

## Chunk 3: Verification and Commit

### Task 3: Verify Live Dashboard Refresh Slice

**Files:**

- Modify: `docs/superpowers/plans/2026-04-24-gammascope-live-dashboard-refresh.md`

- [x] **Step 1: Run full checks**

Run:

```bash
pnpm contracts:validate
pnpm test:collector
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
git diff --check
```

Expected: all checks pass.

- [x] **Step 2: Browser smoke**

Run API and web on temporary ports, publish mock snapshots with different spot values, and verify the in-app browser dashboard updates without a manual page reload.

- [x] **Step 3: Commit live refresh slice**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-24-gammascope-live-dashboard-refresh.md apps/web
git commit -m "feat: refresh dashboard from live snapshots"
```
