# Shared Chart Inspector Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated per-chart inspection tooltip tables with one shared inspector bar while preserving synchronized crosshairs and keyboard/mouse inspection.

**Architecture:** `DashboardView` continues to own `inspectedStrike` and `inspection`. `DashboardChart` keeps hit zones and crosshair rendering, but renders only a compact chart-specific inspection chip. A new `ChartInspectionBar` component renders the full semantic call/put table once below the chart grid.

**Tech Stack:** React 19, Next.js app components, Vitest, happy-dom interaction tests, CSS in `apps/web/app/styles.css`.

---

### Task 1: Replace Per-Chart Tooltip With Compact Chart Chip

**Files:**
- Modify: `apps/web/components/DashboardChart.tsx`
- Modify: `apps/web/tests/DashboardChart.test.tsx`
- Modify: `apps/web/app/styles.css`

- [ ] **Step 1: Write failing chart tests**

Update `apps/web/tests/DashboardChart.test.tsx`.

Add assertions to the inspected-strike test so chart markup no longer contains the full tooltip table:

```tsx
expect(markup).not.toContain("chartInspectionTooltip");
expect(markup).not.toContain("Call and put inspection values");
```

Add a new test for the compact chart chip:

```tsx
it("renders a compact chart-specific inspection chip instead of a full tooltip table", () => {
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
        call: {
          bid: "1.00",
          ask: "1.20",
          mid: "1.10",
          iv: "18.80%",
          gamma: "0.01850",
          vanna: "0.00080",
          openInterest: "100"
        },
        put: {
          bid: "1.00",
          ask: "1.20",
          mid: "1.10",
          iv: "20.50%",
          gamma: "0.01800",
          vanna: "0.00100",
          openInterest: "100"
        }
      }}
      onInspectStrike={() => undefined}
      onClearInspection={() => undefined}
    />
  );

  expect(markup).toContain('data-chart-inspection-chip="5200"');
  expect(markup).toContain("5,200");
  expect(markup).toContain("Call Γ 0.01850");
  expect(markup).toContain("Put Γ 0.01800");
  expect(markup).not.toContain("<table");
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: fail because `DashboardChart` still renders `chartInspectionTooltip` and does not render `data-chart-inspection-chip`.

- [ ] **Step 3: Implement compact chart chip**

In `apps/web/components/DashboardChart.tsx`:

- Remove `InspectionTooltip`.
- Add `InspectionChip`.
- Render it after the SVG only when `inspection` exists and `inspectedStrikeInDomain` is true.
- Choose labels by `metricKey`:
  - `custom_iv`: `Call IV`, `Put IV`, values from `inspection.call.iv` and `inspection.put.iv`.
  - `custom_gamma`: `Call Γ`, `Put Γ`, values from `inspection.call.gamma` and `inspection.put.gamma`.
  - `custom_vanna`: `Call Vanna`, `Put Vanna`, values from `inspection.call.vanna` and `inspection.put.vanna`.

Expected render shape:

```tsx
function InspectionChip({ inspection, metricKey }: { inspection: StrikeInspection; metricKey: NumericRowKey }) {
  const values = inspectionChipValues(inspection, metricKey);

  return (
    <div className="chartInspectionChip" data-chart-inspection-chip={inspection.strike} aria-label={`Selected strike ${formatStrike(inspection.strike)}`}>
      <strong>{formatStrike(inspection.strike)}</strong>
      <span>{values.callLabel} {values.callValue}</span>
      <span>{values.putLabel} {values.putValue}</span>
    </div>
  );
}
```

In `apps/web/app/styles.css`:

- Replace tooltip styles with `.chartInspectionChip` styles.
- Keep chip compact, single-line on desktop, wrapping within the chart card when needed.
- Ensure no absolute positioning and no overflow outside `.chartPanel`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx
```

Expected: all `DashboardChart` tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/DashboardChart.tsx apps/web/tests/DashboardChart.test.tsx apps/web/app/styles.css
git commit -m "fix: replace chart tooltip with compact inspection chip"
```

### Task 2: Add Shared Chart Inspection Bar To DashboardView

**Files:**
- Create: `apps/web/components/ChartInspectionBar.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/tests/DashboardView.test.tsx`
- Modify: `apps/web/tests/DashboardView.interaction.test.tsx`
- Create: `apps/web/tests/ChartInspectionBar.test.tsx`
- Modify: `apps/web/app/styles.css`

- [ ] **Step 1: Write failing shared-bar component test**

Create `apps/web/tests/ChartInspectionBar.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChartInspectionBar } from "../components/ChartInspectionBar";

const inspection = {
  strike: 5200,
  distanceLabel: "+1 pts from spot",
  call: {
    bid: "1.00",
    ask: "1.20",
    mid: "1.10",
    iv: "18.80%",
    gamma: "0.01850",
    vanna: "0.00080",
    openInterest: "100"
  },
  put: {
    bid: "2.00",
    ask: "2.30",
    mid: "2.15",
    iv: "20.50%",
    gamma: "0.01800",
    vanna: "0.00100",
    openInterest: "250"
  }
};

describe("ChartInspectionBar", () => {
  it("renders one shared semantic call and put inspection table", () => {
    const markup = renderToStaticMarkup(<ChartInspectionBar inspection={inspection} onClear={vi.fn()} />);

    expect(markup).toContain('data-shared-inspection-bar="5200"');
    expect(markup).toContain("STRIKE");
    expect(markup).toContain("5,200");
    expect(markup).toContain("+1 pts from spot");
    expect(markup).toContain("<table");
    expect(markup).toContain('<th scope="col">Side</th>');
    expect(markup).toContain('<th scope="col">Bid</th>');
    expect(markup).toContain('<th scope="col">Ask</th>');
    expect(markup).toContain('<th scope="col">Mid</th>');
    expect(markup).toContain('<th scope="col">IV</th>');
    expect(markup).toContain('<th scope="col">Gamma</th>');
    expect(markup).toContain('<th scope="col">Vanna</th>');
    expect(markup).toContain('<th scope="col">OI</th>');
    expect(markup).toContain('<th scope="row">Call</th>');
    expect(markup).toContain('<th scope="row">Put</th>');
    expect(markup).toContain("18.80%");
    expect(markup).toContain("0.01800");
    expect(markup).toContain("250");
    expect(markup).toContain("<button");
    expect(markup).toContain("Clear");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/ChartInspectionBar.test.tsx
```

Expected: fail because `ChartInspectionBar` does not exist.

- [ ] **Step 3: Implement ChartInspectionBar**

Create `apps/web/components/ChartInspectionBar.tsx`:

```tsx
import React from "react";
import type { StrikeInspection } from "../lib/chartInspection";

interface ChartInspectionBarProps {
  inspection: StrikeInspection;
  onClear: () => void;
}

export function ChartInspectionBar({ inspection, onClear }: ChartInspectionBarProps) {
  return (
    <section className="sharedInspectionBar" data-shared-inspection-bar={inspection.strike} aria-label="Selected strike inspection">
      <div className="sharedInspectionStrike">
        <span>STRIKE</span>
        <strong>{formatStrike(inspection.strike)}</strong>
        <small>{inspection.distanceLabel}</small>
      </div>
      <div className="sharedInspectionTableWrap">
        <table className="sharedInspectionTable" aria-label="Call and put inspection values">
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Bid</th>
              <th scope="col">Ask</th>
              <th scope="col">Mid</th>
              <th scope="col">IV</th>
              <th scope="col">Gamma</th>
              <th scope="col">Vanna</th>
              <th scope="col">OI</th>
            </tr>
          </thead>
          <tbody>
            <InspectionRow side="Call" values={inspection.call} />
            <InspectionRow side="Put" values={inspection.put} />
          </tbody>
        </table>
      </div>
      <button className="sharedInspectionClear" type="button" onClick={onClear}>
        Clear
      </button>
    </section>
  );
}
```

Add local helpers:

```tsx
function InspectionRow({ side, values }: { side: "Call" | "Put"; values: StrikeInspection["call"] }) {
  return (
    <tr>
      <th scope="row">{side}</th>
      <td>{values.bid}</td>
      <td>{values.ask}</td>
      <td>{values.mid}</td>
      <td>{values.iv}</td>
      <td>{values.gamma}</td>
      <td>{values.vanna}</td>
      <td>{values.openInterest}</td>
    </tr>
  );
}

function formatStrike(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
```

- [ ] **Step 4: Run component test to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/ChartInspectionBar.test.tsx
```

Expected: pass.

- [ ] **Step 5: Write failing DashboardView tests**

Update `apps/web/tests/DashboardView.interaction.test.tsx` so the real `ChartInspectionBar` behavior is visible through the mocked charts:

- Mock charts should still expose inspect/clear buttons.
- After clicking inspect, assert one shared bar exists:

```tsx
expect(container.querySelectorAll("[data-shared-inspection-bar=\"5200\"]")).toHaveLength(1);
expect(container.textContent).toContain("STRIKE");
expect(container.textContent).toContain("Call");
expect(container.textContent).toContain("Put");
expect(container.textContent).toContain("Bid");
expect(container.textContent).toContain("Ask");
expect(container.textContent).toContain("Mid");
expect(container.textContent).toContain("IV");
expect(container.textContent).toContain("Gamma");
expect(container.textContent).toContain("Vanna");
expect(container.textContent).toContain("OI");
```

- Click the shared bar `Clear` button and assert the bar disappears and all charts clear.

Update `apps/web/tests/DashboardView.test.tsx` if needed to assert no shared bar renders by default:

```tsx
expect(markup).not.toContain("data-shared-inspection-bar");
```

- [ ] **Step 6: Run DashboardView tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

Expected: fail because `DashboardView` does not render `ChartInspectionBar`.

- [ ] **Step 7: Wire ChartInspectionBar into DashboardView**

In `apps/web/components/DashboardView.tsx`:

- Import `ChartInspectionBar`.
- Render `<ChartInspectionBar inspection={inspection} onClear={handleClearInspection} />` immediately after `</section>` for `.chartGrid` and before the option-chain section.
- Only render when `inspection` is non-null.

- [ ] **Step 8: Add shared inspector styles**

In `apps/web/app/styles.css`, add:

- `.sharedInspectionBar`
- `.sharedInspectionStrike`
- `.sharedInspectionTableWrap`
- `.sharedInspectionTable`
- `.sharedInspectionClear`

Rules:

- Full chart-grid width.
- Compact horizontal layout on desktop.
- No overflow outside dashboard shell.
- Table wrapper may use `overflow-x: auto` on small widths only.
- Clear button uses existing button visual language.

- [ ] **Step 9: Run DashboardView tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/ChartInspectionBar.test.tsx tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

Expected: all listed tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/ChartInspectionBar.tsx apps/web/components/DashboardView.tsx apps/web/tests/ChartInspectionBar.test.tsx apps/web/tests/DashboardView.test.tsx apps/web/tests/DashboardView.interaction.test.tsx apps/web/app/styles.css
git commit -m "fix: add shared chart inspection bar"
```

### Task 3: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused inspection tests**

Run:

```bash
pnpm --filter @gammascope/web test -- tests/DashboardChart.test.tsx tests/ChartInspectionBar.test.tsx tests/DashboardView.test.tsx tests/DashboardView.interaction.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run web test suite**

Run:

```bash
pnpm --filter @gammascope/web test
```

Expected: all web tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @gammascope/web typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Browser verification**

Open `/replay` in the in-app browser.

Verify:

- Selecting a strike creates three synchronized crosshairs.
- There is exactly one shared inspector bar.
- Chart cards do not contain duplicated large tooltip tables.
- The shared bar contains strike, distance, Call/Put, Bid, Ask, Mid, IV, Gamma, Vanna, and OI.
- Clear removes crosshairs, chips, and the shared bar.

- [ ] **Step 5: Final code review**

Dispatch a final code-review subagent for the whole feature. It must return `APPROVED` before completion.
