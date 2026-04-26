# GammaScope Replay Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal smoke page with a polished, contract-backed GammaScope dashboard that renders seeded replay analytics as the local app surface.

**Architecture:** Keep the page server-rendered and static for this slice, using the shared `AnalyticsSnapshot` fixture already validated by contracts. Add focused TypeScript helper functions for summary metrics, chart domains, SVG paths, and formatting so visual behavior has direct tests. The UI remains replay-backed for now but is shaped like the future live dashboard.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, Vitest, CSS modules/global CSS, shared generated contract types.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Contract-backed dashboard summary metrics.
- SVG IV smile, gamma, and vanna charts built from snapshot rows.
- Option chain table with custom and IBKR comparison values.
- Replay/live-ready status strip with freshness, coverage, expiry, and session.
- Responsive dark product styling.
- Frontend unit tests for helpers and chart path generation.

Out of scope:

- Live WebSocket updates.
- Real replay scrubber controls.
- Client-side scenario controls.
- Charting-library adoption.
- IBKR collector integration.

## File Structure

- Create: `apps/web/lib/dashboardMetrics.ts`
- Create: `apps/web/lib/chartGeometry.ts`
- Create: `apps/web/components/DashboardChart.tsx`
- Create: `apps/web/tests/dashboardMetrics.test.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `README.md`

## Chunk 1: Tested Dashboard Data Helpers

### Task 1: Add Summary and Formatting Tests

**Files:**

- Create: `apps/web/tests/dashboardMetrics.test.ts`
- Create: `apps/web/lib/dashboardMetrics.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert helpers:

- summarize row count, strike range, average custom IV, total absolute gamma, and total absolute vanna.
- format IV as percentage, gamma/vanna as fixed decimals, and null as an em dash.
- produce stable status labels for freshness and coverage.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- dashboardMetrics.test.ts
```

Expected: import failure because `dashboardMetrics.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `apps/web/lib/dashboardMetrics.ts` with pure functions:

- `summarizeSnapshot(snapshot)`
- `formatPercent(value)`
- `formatNumber(value, digits)`
- `formatBasisPointDiff(value)`
- `formatStatusLabel(value)`

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- dashboardMetrics.test.ts
```

Expected: tests pass.

### Task 2: Add Chart Geometry Tests

**Files:**

- Create: `apps/web/lib/chartGeometry.ts`
- Modify: `apps/web/tests/dashboardMetrics.test.ts`

- [ ] **Step 1: Write failing chart tests**

Add tests that assert:

- `buildSeries` filters null values and sorts by strike.
- `buildPath` returns a non-empty SVG path for two or more points.
- `buildPath` returns an empty path for fewer than two points.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- dashboardMetrics.test.ts
```

Expected: import failure because `chartGeometry.ts` does not exist.

- [ ] **Step 3: Implement chart geometry**

Create `apps/web/lib/chartGeometry.ts` with pure SVG helpers and stable default dimensions.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- dashboardMetrics.test.ts
```

Expected: tests pass.

## Chunk 2: Product Dashboard UI

### Task 3: Replace Smoke Page

**Files:**

- Create: `apps/web/components/DashboardChart.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Build chart component**

Create a small server-compatible SVG chart component using `buildSeries` and `buildPath`.

- [ ] **Step 2: Replace page content**

Render:

- top utility bar with GammaScope, mode, source status, and freshness.
- KPI row for SPX spot, expiry, strike coverage, average IV, gamma, and vanna.
- three chart panels for IV smile, gamma by strike, and vanna by strike.
- option chain table with bid/ask/mid, custom analytics, IBKR values, diffs, and statuses.

- [ ] **Step 3: Add styling**

Use app-level CSS in `layout.tsx` or a global stylesheet to make the page dark, responsive, dense, and readable. Keep it app-like, not a landing page.

- [ ] **Step 4: Run web checks**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: typecheck and tests pass.

### Task 4: Manual Browser Verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Document local dashboard command**

Add a short README note telling the user to run `pnpm dev:web` and open `http://localhost:3000`.

- [ ] **Step 2: Start the web dev server**

Run:

```bash
pnpm dev:web
```

Expected: Next serves the dashboard on an available local port.

- [ ] **Step 3: Inspect in browser**

Open the local dashboard in the in-app browser and verify:

- text is readable.
- charts are visible and nonblank.
- table does not overflow incoherently on desktop.
- mobile viewport remains usable.

- [ ] **Step 4: Full verification**

Run:

```bash
pnpm contracts:validate
pnpm contracts:generate
pnpm --filter @gammascope/contracts typecheck:generated
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
```

Expected: all checks pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-23-gammascope-replay-dashboard.md apps/web
git commit -m "feat: add replay dashboard"
```
