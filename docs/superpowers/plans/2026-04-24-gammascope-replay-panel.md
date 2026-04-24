# GammaScope Replay Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a replay demo panel to the dashboard so a reviewer can load the seeded replay session without IBKR or live collector state.

**Architecture:** Keep replay request plumbing separate from dashboard rendering, matching the existing snapshot/scenario helper pattern. `LiveDashboard` owns mode state and pauses live polling while a replay snapshot is displayed; the same dashboard view renders live, replay, and scenario snapshots.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, existing FastAPI replay endpoints.

---

## File Structure

- Create `apps/web/lib/clientReplaySource.ts`
  - Client helper for `GET /api/spx/0dte/replay/sessions` and `GET /api/spx/0dte/replay/snapshot`.
  - Defines a small `ReplaySession` interface.
  - Validates session records and replay snapshot responses.
- Create `apps/web/tests/clientReplaySource.test.ts`
  - Tests sessions fetch, snapshot fetch, invalid payloads, non-OK responses, and fetch rejection.
- Create `apps/web/app/api/spx/0dte/replay/sessions/route.ts`
  - Next proxy for FastAPI replay sessions endpoint.
- Create `apps/web/app/api/spx/0dte/replay/snapshot/route.ts`
  - Next proxy for FastAPI replay snapshot endpoint.
- Create `apps/web/tests/replayRoute.test.ts`
  - Route tests for both replay proxy endpoints.
- Create `apps/web/components/ReplayPanel.tsx`
  - Compact replay controls.
- Modify `apps/web/components/LiveDashboard.tsx`
  - Load sessions, load replay snapshot, pause polling while replay is active, and return to live.
- Modify `apps/web/components/DashboardView.tsx`
  - Accept a second optional panel slot, or a generic dashboard controls slot, without taking fetch responsibility.
- Modify `apps/web/app/styles.css`
  - Add compact replay panel styles using the existing dashboard palette.
- Add or extend `apps/web/tests/LiveDashboard.test.tsx`
  - Pure helper and render coverage for replay controls and polling state.

## Task 1: Replay Request Plumbing

**Files:**
- Create: `apps/web/lib/clientReplaySource.ts`
- Create: `apps/web/tests/clientReplaySource.test.ts`
- Create: `apps/web/app/api/spx/0dte/replay/sessions/route.ts`
- Create: `apps/web/app/api/spx/0dte/replay/snapshot/route.ts`
- Create: `apps/web/tests/replayRoute.test.ts`

- [ ] **Step 1: Write failing client helper tests**

Write tests proving:
- `loadClientReplaySessions({ fetcher })` requests `/api/spx/0dte/replay/sessions` with `Accept: application/json` and `cache: "no-store"`.
- It returns valid replay session records.
- It returns `[]` on rejected fetch, non-OK response, or invalid payload.
- `loadClientReplaySnapshot(request, { fetcher })` requests `/api/spx/0dte/replay/snapshot?session_id=...&at=...`.
- It returns a valid `AnalyticsSnapshot`.
- It returns `null` on rejected fetch, non-OK response, or invalid payload.

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement minimal client helper**

Create `clientReplaySource.ts`:
- `ReplaySession` interface with `session_id`, `symbol`, `expiry`, `start_time`, `end_time`, and `snapshot_count`.
- `loadClientReplaySessions`.
- `loadClientReplaySnapshot`.
- Reuse `isAnalyticsSnapshot` for snapshot validation.

- [ ] **Step 3: Verify client helper tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing replay route tests**

Write tests proving:
- sessions proxy forwards to `http://127.0.0.1:8000/api/spx/0dte/replay/sessions` by default and returns no-store JSON.
- snapshot proxy forwards `session_id` and optional `at` to FastAPI and returns no-store `AnalyticsSnapshot`.
- both proxies return no-store `502` JSON on upstream failure or invalid payload.

Run:

```bash
pnpm --filter @gammascope/web test -- replayRoute.test.ts
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 5: Implement minimal replay routes**

Create the two route files:
- Use `GAMMASCOPE_API_BASE_URL` or default `http://127.0.0.1:8000`.
- Set `Cache-Control: no-store` on all responses.
- Validate sessions with the same session guard used by the client helper.
- Validate snapshots with `isAnalyticsSnapshot`.

- [ ] **Step 6: Verify route tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts replayRoute.test.ts
```

Expected: PASS.

## Task 2: Dashboard Replay Panel

**Files:**
- Create: `apps/web/components/ReplayPanel.tsx`
- Modify: `apps/web/components/LiveDashboard.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/tests/LiveDashboard.test.tsx`

- [ ] **Step 1: Write failing render/state tests**

Add tests proving:
- rendered dashboard includes replay controls.
- `shouldPollLiveSnapshot` disables polling while replay mode is active.
- a pure helper creates a replay snapshot request from a selected replay session.
- a pure helper only applies the latest non-canceled replay response.

Run:

```bash
pnpm --filter @gammascope/web test -- LiveDashboard.test.tsx
```

Expected: FAIL because replay panel/state helpers do not exist.

- [ ] **Step 2: Implement minimal replay panel and state**

Create `ReplayPanel`:
- Shows a compact title `Replay`.
- Shows the selected seeded session id if sessions are available.
- Button `Load replay`.
- Button `Return to live` only when replay mode is active.
- Short error/status message when replay load fails or no sessions are available.

Update `LiveDashboard`:
- Load replay sessions once on mount with `loadClientReplaySessions`.
- Track selected replay session id.
- `loadReplay` requests the selected session snapshot and applies it if still latest and not canceled.
- Set replay mode active on successful replay snapshot.
- Pause live polling when either scenario mode or replay mode is active.
- Returning to live cancels pending scenario/replay responses, clears replay mode, and performs a guarded live refresh.
- Applying a scenario should clear replay mode, because scenario mode owns the displayed snapshot.

Update `DashboardView`:
- Render a generic controls area or two optional panel slots between session band and KPI grid.

- [ ] **Step 3: Style replay controls**

Add CSS using existing dense dark dashboard style:
- no nested cards
- max 8px radius
- compact layout that fits mobile
- no marketing copy

- [ ] **Step 4: Verify targeted web tests pass**

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts replayRoute.test.ts LiveDashboard.test.tsx DashboardView.test.tsx
pnpm typecheck:web
```

Expected: PASS.

## Acceptance Criteria

- Dashboard shows replay controls at `http://localhost:3000`.
- Loading replay switches the dashboard to the seeded replay snapshot.
- Live polling does not overwrite the replay snapshot while replay mode is active.
- Returning to live resumes live polling and guarded live refresh.
- Scenario controls continue to work from live or replay snapshots.
- Existing live snapshot, scenario panel, charts, and option chain continue to work.
- No auth, persistence, hosted deployment, or multi-snapshot replay scrubber is included in this slice.
