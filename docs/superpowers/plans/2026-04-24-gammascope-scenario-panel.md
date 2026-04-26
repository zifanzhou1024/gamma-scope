# GammaScope Scenario Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact scenario panel to the existing dashboard so users can shift spot, volatility, and time against the current SPX 0DTE snapshot.

**Architecture:** Keep scenario request plumbing separate from dashboard rendering. Add a client helper for posting scenario requests, then let `LiveDashboard` own scenario state so polling pauses while a scenario result is displayed and resumes when the user returns to live.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, existing FastAPI scenario endpoint.

---

## File Structure

- Create `apps/web/lib/clientScenarioSource.ts`
  - Client-side helper that posts a scenario request to `/api/spx/0dte/scenario`.
  - Validates response with existing `isAnalyticsSnapshot`.
  - Returns `AnalyticsSnapshot | null`.
- Create `apps/web/tests/clientScenarioSource.test.ts`
  - TDD coverage for request shape, valid response, invalid response, non-OK response, and rejected fetch.
- Create `apps/web/app/api/spx/0dte/scenario/route.ts`
  - Next API proxy that forwards POST requests to FastAPI `/api/spx/0dte/scenario`.
  - Uses `GAMMASCOPE_API_BASE_URL` with default `http://127.0.0.1:8000`.
  - Returns `502` JSON on upstream failure or invalid upstream payload.
- Create `apps/web/tests/scenarioRoute.test.ts`
  - Route tests using a mocked server helper or injected fetch pattern if needed.
- Create `apps/web/components/ScenarioPanel.tsx`
  - Client component with three numeric inputs:
    - spot shift points
    - vol shift points
    - time shift minutes
  - Shows apply/reset controls and loading/error state.
  - Emits a valid `AnalyticsSnapshot` to parent on success.
- Modify `apps/web/components/LiveDashboard.tsx`
  - Owns `scenarioActive` state.
  - Stops snapshot polling while scenario mode is active.
  - Resumes live polling when user clicks return-to-live.
- Modify `apps/web/components/DashboardView.tsx`
  - Accept optional scenario panel slot/controls without making the pure dashboard responsible for fetching.
- Modify `apps/web/app/styles.css`
  - Add compact, existing-style scenario panel layout.
- Add or extend web tests for scenario-mode behavior.

## Task 1: Scenario Request Plumbing

**Files:**
- Create: `apps/web/lib/clientScenarioSource.ts`
- Create: `apps/web/tests/clientScenarioSource.test.ts`
- Create: `apps/web/app/api/spx/0dte/scenario/route.ts`
- Create: `apps/web/tests/scenarioRoute.test.ts`

- [ ] **Step 1: Write failing client helper tests**

Write tests proving `requestClientScenarioSnapshot`:
- POSTs to `/api/spx/0dte/scenario`
- sends `Content-Type: application/json` and `Accept: application/json`
- JSON-serializes `session_id`, `snapshot_time`, `spot_shift_points`, `vol_shift_points`, and `time_shift_minutes`
- returns a valid `AnalyticsSnapshot`
- returns `null` on fetch rejection, non-OK response, or invalid payload

Run:

```bash
pnpm --filter @gammascope/web test -- clientScenarioSource.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement minimal client helper**

Create `apps/web/lib/clientScenarioSource.ts` with:
- `ScenarioRequest` interface
- `requestClientScenarioSnapshot(request, { fetcher } = {})`
- `fetcher` injection matching existing `clientSnapshotSource` test style
- validation via existing `isAnalyticsSnapshot`

- [ ] **Step 3: Verify client helper tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- clientScenarioSource.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing scenario route test**

Write a test proving `POST /api/spx/0dte/scenario` proxy returns a valid upstream scenario snapshot with `Cache-Control: no-store`.

Run:

```bash
pnpm --filter @gammascope/web test -- scenarioRoute.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 5: Implement minimal route**

Create `apps/web/app/api/spx/0dte/scenario/route.ts`:
- Parse incoming request JSON.
- Forward to `${apiBaseUrl}/api/spx/0dte/scenario`.
- Validate upstream payload with `isAnalyticsSnapshot`.
- Return JSON snapshot with `Cache-Control: no-store`.
- Return `502` JSON with no-store on upstream failure, non-OK, or invalid payload.

- [ ] **Step 6: Verify route tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- clientScenarioSource.test.ts scenarioRoute.test.ts
```

Expected: PASS.

## Task 2: Dashboard Scenario Panel

**Files:**
- Create: `apps/web/components/ScenarioPanel.tsx`
- Modify: `apps/web/components/LiveDashboard.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Add/modify tests under `apps/web/tests/`

- [ ] **Step 1: Write failing render/state tests**

Add tests proving:
- Dashboard markup includes "Scenario" controls when rendered through `LiveDashboard`.
- A pure helper creates the scenario request from the current snapshot plus control values.
- A pure helper says live polling is disabled while a scenario snapshot is active.

Run:

```bash
pnpm --filter @gammascope/web test -- LiveDashboard.test.tsx
```

Expected: FAIL because `ScenarioPanel` and scenario state do not exist.

- [ ] **Step 2: Implement minimal scenario panel and state**

Create `ScenarioPanel`:
- Numeric inputs with stable labels:
  - `Spot shift`
  - `Vol shift`
  - `Time shift`
- Submit button labeled `Apply scenario`.
- Secondary button labeled `Return to live` only when scenario mode is active.
- Shows a short error message if request fails.

Update `LiveDashboard`:
- Calls `requestClientScenarioSnapshot` with current `session_id` and `snapshot_time`.
- Applies returned snapshot to dashboard and sets `scenarioActive`.
- Does not start polling while `scenarioActive` is true.
- Resumes polling and reloads live snapshot when returning to live.
- Export small pure helpers only if needed for tests; do not add test-only behavior to production components.

Update `DashboardView`:
- Accepts an optional `scenarioPanel` prop and renders it between session band and KPI grid.

- [ ] **Step 3: Style the panel**

Add CSS using existing palette and density:
- no nested cards
- compact grid controls
- 8px radius or less
- text must fit on mobile
- no decorative blobs or landing-page copy

- [ ] **Step 4: Verify web tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- LiveDashboard.test.tsx clientScenarioSource.test.ts scenarioRoute.test.ts
pnpm typecheck:web
```

Expected: PASS.

## Acceptance Criteria

- Dashboard has visible scenario controls on `http://localhost:3000`.
- Applying a scenario uses the current snapshot session and timestamp.
- Scenario results remain visible until the user returns to live.
- Returning to live resumes regular snapshot polling.
- Scenario failures show an error without replacing the current dashboard data.
- Existing snapshot loading, charts, and option chain continue to work.
- No auth, persistence, saved scenarios, or backend formula changes are included in this slice.
