# SPX 0DTE Market Reference Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first trading-usefulness phase: stabilize current IV/color polish, then add SPX spot/forward chart references, ATM chart values, vanna zero line, net exposure metrics, and a market map panel.

**Architecture:** Keep calculations in `apps/web/lib/dashboardMetrics.ts`, SVG geometry/rendering in `apps/web/components/DashboardChart.tsx`, and dashboard composition in `apps/web/components/DashboardView.tsx`. No backend API schema changes are required for this phase. The UI should reuse the existing dark market-ops style and current dashboard layout.

**Tech Stack:** Next.js, React, TypeScript, Vitest, React server rendering tests, CSS modules via global stylesheet.

---

## File Structure

- Modify `apps/web/lib/dashboardMetrics.ts`
  - Add net gamma/vanna fields to `SnapshotSummary`.
  - Add market map derivation helpers.
  - Add ATM aggregate helpers.
- Modify `apps/web/tests/dashboardMetrics.test.ts`
  - Cover net exposure, ATM values, IV lows, gamma peak, vanna flip, and vanna max.
- Modify `apps/web/lib/chartGeometry.ts`
  - Add small projection helpers if needed for x/y reference lines.
- Modify `apps/web/components/DashboardChart.tsx`
  - Accept `spot`, `forward`, and optional `atmValue`.
  - Render spot/forward reference lines.
  - Render vanna zero line when requested.
  - Replace `Current` chart stat with an ATM label when an ATM value is provided.
- Modify `apps/web/tests/DashboardChart.test.tsx`
  - Cover spot/forward reference lines, ATM labels, and vanna zero line.
- Modify `apps/web/components/DashboardView.tsx`
  - Render the market map panel.
  - Expand KPI cards to include net and absolute exposures.
  - Pass spot/forward/ATM values to all three charts.
- Modify `apps/web/tests/DashboardView.test.tsx`
  - Cover market map rendering and expanded exposure labels.
- Modify `apps/web/app/styles.css`
  - Style market map, reference labels, chart reference lines, and vanna zero line.

## Task 0: Stabilize Current IV Low And Call/Put Color Polish

**Files:**
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/components/DashboardChart.tsx`
- Test: `apps/web/tests/DashboardChart.test.tsx`
- Test: `apps/web/tests/DashboardView.test.tsx`

- [ ] **Step 1: Verify the current focused tests**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx tests/DashboardView.test.tsx
```

Expected: the focused tests pass. If they fail, fix only the existing IV low marker or call/put color polish before continuing.

- [ ] **Step 2: Commit only the existing polish files**

Run:

```bash
git add apps/web/app/styles.css apps/web/components/DashboardChart.tsx apps/web/tests/DashboardChart.test.tsx apps/web/tests/DashboardView.test.tsx
git commit -m "feat: mark IV lows and align option colors"
```

Expected: a commit containing only current IV low marker and call/put color semantic changes.

## Task 1: Add Market Map And Net Exposure Metrics

**Files:**
- Modify: `apps/web/lib/dashboardMetrics.ts`
- Test: `apps/web/tests/dashboardMetrics.test.ts`

- [ ] **Step 1: Write failing tests for net exposure and market map extraction**

Add imports for `deriveMarketMap` and `getAtmMetricValue` from `../lib/dashboardMetrics`.

Add this test data and tests inside `describe("dashboard metrics", () => { ... })`:

```ts
const marketMapSnapshot = {
  ...seedSnapshot,
  spot: 5206,
  forward: 5207.5,
  rows: [
    { ...seedSnapshot.rows[0]!, strike: 5190, right: "call" as const, custom_iv: 0.22, custom_gamma: -0.01, custom_vanna: -0.04 },
    { ...seedSnapshot.rows[1]!, strike: 5190, right: "put" as const, custom_iv: 0.24, custom_gamma: -0.02, custom_vanna: -0.03 },
    { ...seedSnapshot.rows[2]!, strike: 5200, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.03, custom_vanna: -0.01 },
    { ...seedSnapshot.rows[3]!, strike: 5200, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.02, custom_vanna: 0.005 },
    { ...seedSnapshot.rows[4]!, strike: 5210, right: "call" as const, custom_iv: 0.21, custom_gamma: 0.04, custom_vanna: 0.03 },
    { ...seedSnapshot.rows[5]!, strike: 5210, right: "put" as const, custom_iv: 0.17, custom_gamma: 0.01, custom_vanna: 0.02 }
  ]
};

it("summarizes net and absolute exposures", () => {
  const summary = summarizeSnapshot(marketMapSnapshot);

  expect(summary.totalNetGamma).toBeCloseTo(0.07);
  expect(summary.totalAbsGamma).toBeCloseTo(0.13);
  expect(summary.totalNetVanna).toBeCloseTo(-0.025);
  expect(summary.totalAbsVanna).toBeCloseTo(0.135);
});

it("derives spot-relative market map levels", () => {
  const marketMap = deriveMarketMap(marketMapSnapshot);

  expect(marketMap.spot).toBe(5206);
  expect(marketMap.forward).toBe(5207.5);
  expect(marketMap.atmStrike).toBe(5210);
  expect(marketMap.callIvLow).toMatchObject({ strike: 5200, value: 0.18 });
  expect(marketMap.putIvLow).toMatchObject({ strike: 5210, value: 0.17 });
  expect(marketMap.gammaPeak).toMatchObject({ strike: 5210, value: 0.05 });
  expect(marketMap.vannaFlip?.strike).toBeCloseTo(5202);
  expect(marketMap.vannaMax).toMatchObject({ strike: 5210, value: 0.05 });
});

it("returns ATM aggregate values for chart headers", () => {
  expect(getAtmMetricValue(marketMapSnapshot, "custom_iv")).toBeCloseTo(0.19);
  expect(getAtmMetricValue(marketMapSnapshot, "custom_gamma")).toBeCloseTo(0.05);
  expect(getAtmMetricValue(marketMapSnapshot, "custom_vanna")).toBeCloseTo(0.05);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/dashboardMetrics.test.ts
```

Expected: FAIL because `deriveMarketMap`, `getAtmMetricValue`, `totalNetGamma`, and `totalNetVanna` do not exist yet.

- [ ] **Step 3: Implement minimal metrics**

In `apps/web/lib/dashboardMetrics.ts`:

- Extend `SnapshotSummary` with:

```ts
totalNetGamma: number;
totalNetVanna: number;
```

- Add exported interfaces:

```ts
export interface MarketLevel {
  strike: number;
  value: number;
  source?: "crossing" | "nearest_zero";
}

export interface MarketMap {
  spot: number;
  forward: number;
  atmStrike: number | null;
  callIvLow: MarketLevel | null;
  putIvLow: MarketLevel | null;
  gammaPeak: MarketLevel | null;
  vannaFlip: MarketLevel | null;
  vannaMax: MarketLevel | null;
}
```

- Add `sum(values: number[]): number`.
- Add `aggregateByStrike(rows, key)` that sums non-null values by strike.
- Add `findSideMinimum(rows, right, key)`.
- Add `findLargestAbsLevel(levels)`.
- Add `findLargestValueLevel(levels)`.
- Add `findZeroCrossing(levels)` using linear interpolation between adjacent sorted strike levels; if no crossing exists, return nearest absolute value with `source: "nearest_zero"`.
- Add:

```ts
export function deriveMarketMap(snapshot: AnalyticsSnapshot): MarketMap
export function getAtmMetricValue(snapshot: AnalyticsSnapshot, metricKey: "custom_iv" | "custom_gamma" | "custom_vanna"): number | null
```

Use nearest listed strike to spot for ATM. Average available side IV values at ATM. Sum gamma/vanna values at ATM.

- [ ] **Step 4: Run metrics test to verify it passes**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/dashboardMetrics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit metrics slice**

Run:

```bash
git add apps/web/lib/dashboardMetrics.ts apps/web/tests/dashboardMetrics.test.ts
git commit -m "feat: derive SPX market map metrics"
```

Expected: commit contains only metrics and metrics tests.

## Task 2: Add Chart Reference Lines And ATM Labels

**Files:**
- Modify: `apps/web/components/DashboardChart.tsx`
- Modify: `apps/web/lib/chartGeometry.ts` if projection helpers are needed
- Test: `apps/web/tests/DashboardChart.test.tsx`

- [ ] **Step 1: Write failing chart rendering tests**

Add tests to `apps/web/tests/DashboardChart.test.tsx`:

```tsx
it("renders SPX spot and forward reference lines", () => {
  const markup = renderToStaticMarkup(
    <DashboardChart
      rows={baseRows}
      title="Gamma by strike"
      metricKey="custom_gamma"
      tone="violet"
      valueKind="decimal"
      spot={5199}
      forward={5202}
      atmValue={0.018}
    />
  );

  expect(markup).toContain('data-reference-line="spot"');
  expect(markup).toContain("SPX spot 5,199.00");
  expect(markup).toContain('data-reference-line="forward"');
  expect(markup).toContain("Forward 5,202.00");
  expect(markup).toContain("ATM Gamma");
  expect(markup).toContain("0.01800");
});

it("renders a zero line on vanna charts when zero is inside the domain", () => {
  const markup = renderToStaticMarkup(
    <DashboardChart
      rows={baseRows}
      title="Vanna by strike"
      metricKey="custom_vanna"
      tone="teal"
      valueKind="decimal"
      spot={5200}
      forward={5200}
      atmValue={0.0018}
      showZeroLine
    />
  );

  expect(markup).toContain('data-zero-line="vanna"');
  expect(markup).toContain("Vanna 0");
  expect(markup).toContain("ATM Vanna");
});
```

- [ ] **Step 2: Run chart tests to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: FAIL because `DashboardChart` does not accept the new props or render the new annotations.

- [ ] **Step 3: Implement chart annotations**

In `DashboardChart.tsx`:

- Extend props:

```ts
spot?: number | null;
forward?: number | null;
atmValue?: number | null;
showZeroLine?: boolean;
```

- Compute `headlineLabel` as:
  - `ATM IV` for `custom_iv` when `atmValue` exists.
  - `ATM Gamma` for `custom_gamma` when `atmValue` exists.
  - `ATM Vanna` for `custom_vanna` when `atmValue` exists.
  - `Current` otherwise.

- Render `ReferenceLine` components after gridlines and before series paths.
- Use existing `projectX` and `projectY` helpers in `DashboardChart.tsx`; if zero projection needs shared extent, add minimal local helper logic rather than redesigning chart geometry.
- Only render spot/forward if the value is inside the chart x-domain.
- Only render vanna zero line if `showZeroLine` is true and zero is inside the chart y-domain.

- [ ] **Step 4: Run chart tests to verify pass**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit chart slice**

Run:

```bash
git add apps/web/components/DashboardChart.tsx apps/web/lib/chartGeometry.ts apps/web/tests/DashboardChart.test.tsx
git commit -m "feat: add spot reference lines to charts"
```

Expected: commit contains only chart annotation changes and chart tests.

## Task 3: Render Market Map And Expanded Exposure KPIs

**Files:**
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `apps/web/tests/DashboardView.test.tsx`

- [ ] **Step 1: Write failing dashboard rendering tests**

Because `DashboardView.test.tsx` currently mocks `DashboardChart`, update the mock to include serialized props needed by this test:

```tsx
vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title, spot, forward, atmValue, showZeroLine }: {
    title: string;
    spot?: number | null;
    forward?: number | null;
    atmValue?: number | null;
    showZeroLine?: boolean;
  }) => (
    <section
      data-chart-title={title}
      data-chart-spot={spot ?? ""}
      data-chart-forward={forward ?? ""}
      data-chart-atm-value={atmValue ?? ""}
      data-chart-zero-line={showZeroLine ? "true" : "false"}
    >
      {title}
    </section>
  )
}));
```

Add tests:

```tsx
it("renders market map levels and expanded exposure metrics", () => {
  const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

  expect(markup).toContain("MARKET MAP");
  expect(markup).toContain("ATM strike");
  expect(markup).toContain("Call IV low");
  expect(markup).toContain("Put IV low");
  expect(markup).toContain("Gamma peak");
  expect(markup).toContain("Vanna flip");
  expect(markup).toContain("Vanna max");
  expect(markup).toContain("Net gamma");
  expect(markup).toContain("Abs gamma");
  expect(markup).toContain("Net vanna");
  expect(markup).toContain("Abs vanna");
});

it("passes spot forward ATM values and vanna zero line flag to charts", () => {
  const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

  expect(markup).toContain('data-chart-spot="5201.25"');
  expect(markup).toContain('data-chart-forward="5202.1"');
  expect(markup).toContain('data-chart-title="IV BY STRIKE"');
  expect(markup).toContain('data-chart-title="GAMMA BY STRIKE"');
  expect(markup).toContain('data-chart-title="VANNA BY STRIKE"');
  expect(markup).toContain('data-chart-zero-line="true"');
});
```

- [ ] **Step 2: Run dashboard tests to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx
```

Expected: FAIL because market map and new chart props are not wired yet.

- [ ] **Step 3: Implement dashboard composition**

In `DashboardView.tsx`:

- Import `deriveMarketMap` and `getAtmMetricValue`.
- Compute:

```ts
const marketMap = deriveMarketMap(snapshot);
const atmIv = getAtmMetricValue(snapshot, "custom_iv");
const atmGamma = getAtmMetricValue(snapshot, "custom_gamma");
const atmVanna = getAtmMetricValue(snapshot, "custom_vanna");
```

- Replace the old six-card KPI exposure section with cards for:
  - SPX spot
  - Forward
  - Strike range
  - Average IV
  - Net gamma
  - Abs gamma
  - Net vanna
  - Abs vanna
- Add `MarketMapPanel` below the KPI grid and above the chart grid.
- Pass `spot={snapshot.spot}`, `forward={snapshot.forward}`, and the corresponding `atmValue` to all charts.
- Pass `showZeroLine` only to the vanna chart.

In `styles.css`:

- Add `.marketMapPanel`, `.marketMapGrid`, `.marketMapItem`, and side/tone modifiers.
- Keep the panel compact and avoid nested-card styling.

- [ ] **Step 4: Run dashboard tests to verify pass**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit dashboard slice**

Run:

```bash
git add apps/web/components/DashboardView.tsx apps/web/app/styles.css apps/web/tests/DashboardView.test.tsx
git commit -m "feat: add SPX market map panel"
```

Expected: commit contains dashboard composition, styles, and dashboard tests.

## Task 4: Full Verification And Browser Check

**Files:**
- Verify only unless a test failure requires a targeted fix.

- [ ] **Step 1: Run focused phase tests**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/dashboardMetrics.test.ts tests/DashboardChart.test.tsx tests/DashboardView.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full web unit tests**

Run:

```bash
pnpm --filter @gammascope/web test
```

Expected: PASS.

- [ ] **Step 3: Run web typecheck**

Run:

```bash
pnpm --filter @gammascope/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Browser-check replay page**

Open `http://127.0.0.1:3012/replay` in the in-app browser.

Expected:

- Top tabs still show realtime/replay/heatmap.
- Admin utility remains in the top-right.
- Market map appears above charts.
- IV, gamma, and vanna charts include spot and forward reference lines.
- Vanna chart includes a visible zero line when data crosses zero.
- IV low badges and call/put colors remain visible.

- [ ] **Step 5: Final commit if verification required a fix**

If a fix was required during verification:

```bash
git add <changed files>
git commit -m "fix: stabilize market reference dashboard"
```

Expected: only targeted verification fixes are committed.
