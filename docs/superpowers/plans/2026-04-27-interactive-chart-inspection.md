# Interactive Chart Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronized hover/focus strike inspection across IV, gamma, and vanna charts.

**Architecture:** `DashboardView` owns a shared `inspectedStrike` state and derives one normalized tooltip model. `DashboardChart` renders invisible SVG strike hit zones, synchronized crosshairs, and a fixed tooltip panel when given the active strike and inspection model.

**Tech Stack:** React 19, Next.js app router, TypeScript, Vitest, happy-dom, SVG.

---

## File Structure

- Create `apps/web/lib/chartInspection.ts`
  - Normalize rows at a selected strike into call/put inspection values.
  - Provide display-ready values and strike distance text.
- Create `apps/web/tests/chartInspection.test.ts`
  - Test call/put values, missing values, strike distance, and null selection behavior.
- Modify `apps/web/components/DashboardChart.tsx`
  - Add inspection props.
  - Render hit zones, synchronized crosshair, and fixed tooltip.
- Modify `apps/web/components/DashboardView.tsx`
  - Own `inspectedStrike`.
  - Derive inspection data.
  - Pass shared inspection props to all charts.
- Modify `apps/web/app/styles.css`
  - Style hit zones, inspection crosshair, and tooltip.
- Modify `apps/web/tests/DashboardChart.test.tsx`
  - Test hit zones, crosshair, and tooltip markup.
- Modify `apps/web/tests/DashboardView.test.tsx`
  - Update chart mock props.
- Create `apps/web/tests/DashboardView.interaction.test.tsx`
  - Render real dashboard and simulate hover/focus to prove synchronized chart inspection.

## Task 1: Inspection Data Helper

**Files:**
- Create: `apps/web/lib/chartInspection.ts`
- Test: `apps/web/tests/chartInspection.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests covering:

```ts
import { describe, expect, it } from "vitest";
import { deriveStrikeInspection } from "../lib/chartInspection";
import type { AnalyticsSnapshot } from "../lib/contracts";

type Row = AnalyticsSnapshot["rows"][number];

describe("deriveStrikeInspection", () => {
  it("derives call and put tooltip values for the selected strike", () => {
    const rows = [
      row({ strike: 5200, right: "call", bid: 1, ask: 1.2, mid: 1.1, custom_iv: 0.18, custom_gamma: 0.01, custom_vanna: -0.02, open_interest: 100 }),
      row({ strike: 5200, right: "put", bid: 2, ask: 2.4, mid: 2.2, custom_iv: 0.21, custom_gamma: 0.03, custom_vanna: 0.04, open_interest: 250 })
    ];

    expect(deriveStrikeInspection(rows, 5200, 5198.75)).toEqual({
      strike: 5200,
      distanceLabel: "+1 pts from spot",
      call: {
        bid: "1.00",
        ask: "1.20",
        mid: "1.10",
        iv: "18.00%",
        gamma: "0.01000",
        vanna: "-0.02000",
        openInterest: "100"
      },
      put: {
        bid: "2.00",
        ask: "2.40",
        mid: "2.20",
        iv: "21.00%",
        gamma: "0.03000",
        vanna: "0.04000",
        openInterest: "250"
      }
    });
  });

  it("returns null without a selected strike and uses em dashes for missing side values", () => {
    expect(deriveStrikeInspection([], null, 5200)).toBeNull();
    const inspection = deriveStrikeInspection([row({ strike: 5210, right: "call", bid: null, ask: null, mid: null })], 5210, 5200);
    expect(inspection?.put.bid).toBe("—");
    expect(inspection?.call.bid).toBe("—");
    expect(inspection?.distanceLabel).toBe("+10 pts from spot");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/chartInspection.test.ts
```

Expected: FAIL because `../lib/chartInspection` does not exist.

- [ ] **Step 3: Implement helper**

Create:

```ts
import { formatInteger, formatNumber, formatPercent, formatPrice } from "./dashboardMetrics";
import type { AnalyticsSnapshot } from "./contracts";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];
type OptionSide = "call" | "put";

export interface StrikeInspectionSide {
  bid: string;
  ask: string;
  mid: string;
  iv: string;
  gamma: string;
  vanna: string;
  openInterest: string;
}

export interface StrikeInspection {
  strike: number;
  distanceLabel: string;
  call: StrikeInspectionSide;
  put: StrikeInspectionSide;
}

export function deriveStrikeInspection(
  rows: AnalyticsRow[],
  strike: number | null,
  spot: number
): StrikeInspection | null {
  if (strike == null) {
    return null;
  }

  const call = rows.find((row) => row.strike === strike && row.right === "call") ?? null;
  const put = rows.find((row) => row.strike === strike && row.right === "put") ?? null;

  return {
    strike,
    distanceLabel: formatStrikeDistance(strike, spot),
    call: formatInspectionSide(call),
    put: formatInspectionSide(put)
  };
}

function formatInspectionSide(row: AnalyticsRow | null): StrikeInspectionSide {
  return {
    bid: formatPrice(row?.bid),
    ask: formatPrice(row?.ask),
    mid: formatPrice(row?.mid),
    iv: formatPercent(row?.custom_iv),
    gamma: formatNumber(row?.custom_gamma, 5),
    vanna: formatNumber(row?.custom_vanna, 5),
    openInterest: formatInteger(row?.open_interest)
  };
}

function formatStrikeDistance(strike: number, spot: number): string {
  const distance = Math.round(strike - spot);
  if (distance === 0) {
    return "At spot";
  }
  return `${distance > 0 ? "+" : ""}${distance} pts from spot`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/chartInspection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/chartInspection.ts apps/web/tests/chartInspection.test.ts
git commit -m "feat: derive chart strike inspection data"
```

## Task 2: Chart Hit Zones, Crosshair, And Tooltip

**Files:**
- Modify: `apps/web/components/DashboardChart.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `apps/web/tests/DashboardChart.test.tsx`

- [ ] **Step 1: Write failing chart tests**

Add tests asserting:

```ts
it("renders strike hit zones for chart inspection", () => {
  const markup = renderToStaticMarkup(
    <DashboardChart
      rows={baseRows}
      title="Gamma by strike"
      metricKey="custom_gamma"
      tone="violet"
      valueKind="decimal"
      onInspectStrike={() => undefined}
      onClearInspection={() => undefined}
    />
  );

  expect(markup).toContain('data-chart-hit-strike="5190"');
  expect(markup).toContain('data-chart-hit-strike="5200"');
  expect(markup).toContain('data-chart-hit-strike="5210"');
  expect(markup).toContain("Inspect 5,200");
});

it("renders synchronized crosshair and tooltip for the inspected strike", () => {
  const markup = renderToStaticMarkup(
    <DashboardChart
      rows={baseRows}
      title="Gamma by strike"
      metricKey="custom_gamma"
      tone="violet"
      valueKind="decimal"
      inspectedStrike={5200}
      inspection={{
        strike: 5200,
        distanceLabel: "+1 pts from spot",
        call: { bid: "1.00", ask: "1.20", mid: "1.10", iv: "18.80%", gamma: "0.01850", vanna: "0.00080", openInterest: "100" },
        put: { bid: "1.00", ask: "1.20", mid: "1.10", iv: "20.50%", gamma: "0.01800", vanna: "0.00100", openInterest: "100" }
      }}
    />
  );

  expect(markup).toContain('data-inspection-crosshair="5200"');
  expect(markup).toContain('data-inspection-tooltip="5200"');
  expect(markup).toContain("Strike 5,200");
  expect(markup).toContain("Call");
  expect(markup).toContain("Put");
  expect(markup).toContain("18.80%");
  expect(markup).toContain("0.01850");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: FAIL because the new props/markup do not exist.

- [ ] **Step 3: Implement minimal chart support**

In `DashboardChart.tsx`:
- Import `type StrikeInspection`.
- Add props:
  - `inspectedStrike?: number | null`
  - `inspection?: StrikeInspection | null`
  - `onInspectStrike?: (strike: number) => void`
  - `onClearInspection?: () => void`
- Build unique strike hit zones from the chart domain.
- Render `InspectionCrosshair` when active strike is in domain.
- Render `InspectionTooltip` when `inspection` is not null.
- Render hit zones after visible series so pointer targets are available but transparent.

- [ ] **Step 4: Add CSS**

In `styles.css` add compact styles:

```css
.chartHitZone {
  cursor: crosshair;
  fill: transparent;
}

.chartHitZone:focus {
  outline: none;
}

.chartInspectionCrosshair line {
  stroke: rgba(248, 250, 252, 0.78);
  stroke-width: 1.4;
}

.chartInspectionCrosshair text {
  fill: #f8fafc;
  font-size: 10px;
  font-weight: 900;
}

.chartInspectionTooltip {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(8, 13, 22, 0.82);
  display: grid;
  gap: 8px;
  padding: 10px;
}
```

- [ ] **Step 5: Run chart tests**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/DashboardChart.tsx apps/web/app/styles.css apps/web/tests/DashboardChart.test.tsx
git commit -m "feat: add chart inspection affordances"
```

## Task 3: Dashboard Synchronization

**Files:**
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/tests/DashboardView.test.tsx`
- Create: `apps/web/tests/DashboardView.interaction.test.tsx`

- [ ] **Step 1: Write failing DashboardView prop test**

Update the DashboardChart mock in `DashboardView.test.tsx` to include `inspectedStrike`, `inspection`, `onInspectStrike`, and `onClearInspection` in data attributes. Assert all charts receive inspection-capable props.

- [ ] **Step 2: Write failing interaction test**

Create `DashboardView.interaction.test.tsx` with happy-dom, render real `DashboardView`, dispatch `mouseEnter` on `[data-chart-hit-strike="5200"]`, and assert three `[data-inspection-crosshair="5200"]` elements plus visible tooltip text.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

Expected: FAIL until `DashboardView` owns and passes shared inspection state.

- [ ] **Step 4: Implement synchronization**

In `DashboardView.tsx`:
- Import `deriveStrikeInspection`.
- Add `const [inspectedStrike, setInspectedStrike] = useState<number | null>(null);`.
- Add `const strikeInspection = deriveStrikeInspection(rows, inspectedStrike, snapshot.spot);`.
- Pass `inspectedStrike`, `inspection={strikeInspection}`, `onInspectStrike={setInspectedStrike}`, and `onClearInspection={() => setInspectedStrike(null)}` to all three charts.

- [ ] **Step 5: Run dashboard tests**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/DashboardView.tsx apps/web/tests/DashboardView.test.tsx apps/web/tests/DashboardView.interaction.test.tsx
git commit -m "feat: synchronize chart strike inspection"
```

## Task 4: Final Verification

**Files:**
- No code files expected.

- [ ] **Step 1: Run targeted tests**

```bash
pnpm --filter @gammascope/web test -- tests/chartInspection.test.ts tests/DashboardChart.test.tsx tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

- [ ] **Step 2: Run full web tests**

```bash
pnpm --filter @gammascope/web test
```

- [ ] **Step 3: Run web typecheck**

```bash
pnpm --filter @gammascope/web typecheck
```

- [ ] **Step 4: Browser verification**

Open `http://127.0.0.1:3010/replay`, hover a chart strike, and verify:
- crosshair appears on IV, gamma, and vanna charts;
- tooltip shows strike, call/put IV, gamma, vanna, bid/ask/mid, and OI;
- replay transport still works.

- [ ] **Step 5: Final review**

Dispatch final code reviewer with the implementation range and verification evidence.
