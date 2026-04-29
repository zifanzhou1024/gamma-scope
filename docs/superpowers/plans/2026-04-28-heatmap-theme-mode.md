# Heatmap Theme Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared dark/light theme switch to the heatmap page and restyle the heatmap so dark and light modes use the same strong semantic cell palette while only the surrounding shell changes.

**Architecture:** Reuse the existing global `ThemeToggle` and `themePreference` storage/cookie flow. Keep API and collector code untouched. Add heatmap-specific CSS tokens in `apps/web/app/styles.css` and wire the existing `exposureToneClass` classes to those tokens.

**Tech Stack:** Next.js App Router, React 19, Vitest with happy-dom, CSS custom properties, existing GammaScope theme preference utilities.

---

## File Structure

- Modify `apps/web/components/ExposureHeatmap.tsx`
  - Responsibility: render the heatmap shell and controls.
  - Add `ThemeToggle` to the heatmap top bar using the same component as Realtime/Replay.
- Modify `apps/web/tests/ExposureHeatmap.test.tsx`
  - Responsibility: component-level behavior coverage for the heatmap.
  - Add tests proving the shared theme switch renders, toggles, and loads saved light preference on Heatmap.
- Modify `apps/web/app/styles.css`
  - Responsibility: global dashboard styling and theme token definitions.
  - Add heatmap-specific CSS tokens and remap the existing heatmap cell classes to the shared B-style palette.
- Create `apps/web/tests/heatmapThemeStyles.test.ts`
  - Responsibility: low-cost CSS contract tests for heatmap theme tokens and class mappings.
  - Keep this test focused on selector/token presence, not visual screenshots.

No backend, collector, API route, or contract files should change.

---

### Task 1: Add The Shared Theme Toggle To Heatmap

**Files:**
- Modify: `apps/web/components/ExposureHeatmap.tsx`
- Modify: `apps/web/tests/ExposureHeatmap.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/web/tests/ExposureHeatmap.test.tsx`, add this import with the existing imports:

```ts
import { THEME_STORAGE_KEY } from "../lib/themePreference";
```

Update the existing `afterEach` in the `describe("ExposureHeatmap", ...)` block to clear global theme state:

```ts
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    vi.restoreAllMocks();
  });
```

Add these tests inside the `describe("ExposureHeatmap", ...)` block, after the first render test:

```tsx
  it("renders the shared theme switch in the heatmap header", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    await act(async () => undefined);

    const headerStart = container.innerHTML.indexOf("class=\"topBar heatmapHeader\"");
    const navIndex = container.innerHTML.indexOf("aria-label=\"Dashboard views\"");
    const themeToggleIndex = container.innerHTML.indexOf("data-theme-toggle");
    const statusIndex = container.innerHTML.indexOf("aria-label=\"Heatmap status\"");

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(navIndex).toBeGreaterThan(headerStart);
    expect(themeToggleIndex).toBeGreaterThan(navIndex);
    expect(themeToggleIndex).toBeLessThan(statusIndex);
    expect(container.textContent).toContain("Theme");
    expect(container.textContent).toContain("Dark");

    cleanup(root, container);
  });

  it("toggles the shared light theme from the heatmap header", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    await act(async () => undefined);

    const button = getThemeToggleButton(container);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Light");

    cleanup(root, container);
  });

  it("loads a saved light preference in the heatmap header", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    await act(async () => undefined);

    const button = getThemeToggleButton(container);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Light");

    cleanup(root, container);
  });
```

Add this helper near the existing test helpers:

```ts
function getThemeToggleButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[data-theme-toggle]");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExposureHeatmap.test.tsx
```

Expected: FAIL because `button[data-theme-toggle]` is missing from `ExposureHeatmap`.

- [ ] **Step 3: Add `ThemeToggle` to the heatmap component**

In `apps/web/components/ExposureHeatmap.tsx`, add this import:

```ts
import { ThemeToggle } from "./ThemeToggle";
```

In the empty-state header, replace:

```tsx
        <header className="topBar">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE heatmap</p>
            </div>
          </div>
        </header>
```

with:

```tsx
        <header className="topBar heatmapHeader">
          <div className="topBarPrimary">
            <div className="brandLockup">
              <div className="scopeMark" aria-hidden="true" />
              <div>
                <h1>GammaScope</h1>
                <p>SPX 0DTE heatmap</p>
              </div>
            </div>
          </div>
          <div className="topBarUtility heatmapHeaderUtility">
            <ThemeToggle />
          </div>
        </header>
```

In the main heatmap header, replace:

```tsx
        <div className="heatmapHeaderStats" aria-label="Heatmap status">
          <span>{selectedPayloads.map((payload) => payload.tradingClass).join(" / ")}</span>
          <span>{formatHeatmapStatus(primaryPayload)}</span>
          <span>Last synced {formatHeatmapTime(primaryPayload.lastSyncedAt)}</span>
        </div>
```

with:

```tsx
        <div className="topBarUtility heatmapHeaderUtility">
          <ThemeToggle />
          <div className="heatmapHeaderStats" aria-label="Heatmap status">
            <span>{selectedPayloads.map((payload) => payload.tradingClass).join(" / ")}</span>
            <span>{formatHeatmapStatus(primaryPayload)}</span>
            <span>Last synced {formatHeatmapTime(primaryPayload.lastSyncedAt)}</span>
          </div>
        </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExposureHeatmap.test.tsx tests/ThemeToggle.test.tsx
```

Expected: PASS. The Heatmap test should prove the same storage key and document `data-theme` behavior as the standalone `ThemeToggle` tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/components/ExposureHeatmap.tsx apps/web/tests/ExposureHeatmap.test.tsx
git commit -m "feat: add heatmap theme toggle"
```

---

### Task 2: Add Shared Heatmap Palette And Theme Shell Tokens

**Files:**
- Create: `apps/web/tests/heatmapThemeStyles.test.ts`
- Modify: `apps/web/app/styles.css`

- [ ] **Step 1: Write the failing CSS contract tests**

Create `apps/web/tests/heatmapThemeStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

describe("heatmap theme styles", () => {
  it("defines shared heatmap cell palette tokens once", () => {
    expect(styles).toMatch(/--heatmap-positive-1:\s*#236a75;/);
    expect(styles).toMatch(/--heatmap-positive-2:\s*#2f8f88;/);
    expect(styles).toMatch(/--heatmap-positive-3:\s*#32b77b;/);
    expect(styles).toMatch(/--heatmap-positive-4:\s*#facc15;/);
    expect(styles).toMatch(/--heatmap-negative-1:\s*#315a80;/);
    expect(styles).toMatch(/--heatmap-negative-2:\s*#44307d;/);
    expect(styles).toMatch(/--heatmap-negative-3:\s*#5b006f;/);
    expect(styles).toMatch(/--heatmap-negative-4:\s*#4c005f;/);
    expect(styles.match(/--heatmap-positive-4:/g)).toHaveLength(1);
    expect(styles.match(/--heatmap-negative-4:/g)).toHaveLength(1);
  });

  it("defines light-mode heatmap shell overrides without redefining cell semantics", () => {
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-panel-bg:\s*#ffffff;/);
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-control-bg:\s*#ffffff;/);
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-table-head-bg:\s*#eef3f8;/);
    expect(styles).not.toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-positive-4:/);
    expect(styles).not.toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-negative-4:/);
  });

  it("maps existing heatmap cell classes to the shared palette tokens", () => {
    expect(styles).toMatch(/\.heatmapCell-intensity-4\.heatmapCell-positive\s*{[\s\S]*background:\s*var\(--heatmap-positive-4\);[\s\S]*color:\s*var\(--heatmap-positive-4-text\);/);
    expect(styles).toMatch(/\.heatmapCell-intensity-4\.heatmapCell-negative\s*{[\s\S]*background:\s*var\(--heatmap-negative-4\);[\s\S]*color:\s*var\(--heatmap-negative-4-text\);/);
    expect(styles).toMatch(/\.heatmapPanel\s*{[\s\S]*background:\s*var\(--heatmap-panel-bg\);/);
    expect(styles).toMatch(/\.heatmapPanelHeader\s*{[\s\S]*background:\s*var\(--heatmap-panel-header-bg\);/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/heatmapThemeStyles.test.ts tests/heatmapFormat.test.ts
```

Expected: FAIL because the heatmap token variables and class remaps do not exist yet. `tests/heatmapFormat.test.ts` should continue passing and confirms the class-name contract is unchanged.

- [ ] **Step 3: Add heatmap-specific tokens**

In `apps/web/app/styles.css`, add these variables to `:root` after `--active-blue-text: #bae6fd;`:

```css
  --heatmap-shell-bg: transparent;
  --heatmap-panel-bg: rgba(12, 18, 28, 0.92);
  --heatmap-panel-header-bg: rgba(248, 250, 252, 0.04);
  --heatmap-panel-shadow: 0 18px 42px rgba(0, 0, 0, 0.18);
  --heatmap-control-bg: rgba(15, 23, 42, 0.46);
  --heatmap-control-active-bg: rgba(45, 212, 191, 0.13);
  --heatmap-control-active-border: rgba(45, 212, 191, 0.42);
  --heatmap-control-active-text: #99f6e4;
  --heatmap-control-hover-text: #e0f2fe;
  --heatmap-strike-bg: rgba(8, 13, 25, 0.86);
  --heatmap-table-head-bg: rgba(15, 23, 42, 0.78);
  --heatmap-row-hover-bg: rgba(148, 163, 184, 0.08);
  --heatmap-cell-neutral-bg: rgba(49, 90, 128, 0.34);
  --heatmap-cell-neutral-text: #cbd5e1;
  --heatmap-positive-1: #236a75;
  --heatmap-positive-1-text: #f8fafc;
  --heatmap-positive-2: #2f8f88;
  --heatmap-positive-2-text: #f8fafc;
  --heatmap-positive-3: #32b77b;
  --heatmap-positive-3-text: #052e16;
  --heatmap-positive-4: #facc15;
  --heatmap-positive-4-text: #111827;
  --heatmap-negative-1: #315a80;
  --heatmap-negative-1-text: #f8fafc;
  --heatmap-negative-2: #44307d;
  --heatmap-negative-2-text: #f8fafc;
  --heatmap-negative-3: #5b006f;
  --heatmap-negative-3-text: #fdf4ff;
  --heatmap-negative-4: #4c005f;
  --heatmap-negative-4-text: #fdf4ff;
```

In the `html[data-theme="light"]` block, add these shell-only overrides after `--active-blue-text: #075985;`:

```css
  --heatmap-shell-bg: transparent;
  --heatmap-panel-bg: #ffffff;
  --heatmap-panel-header-bg: #f8fafc;
  --heatmap-panel-shadow: 0 18px 40px rgba(15, 23, 42, 0.1);
  --heatmap-control-bg: #ffffff;
  --heatmap-control-active-bg: #dff7f3;
  --heatmap-control-active-border: rgba(15, 118, 110, 0.36);
  --heatmap-control-active-text: #0f766e;
  --heatmap-control-hover-text: #075985;
  --heatmap-strike-bg: #f1f5f9;
  --heatmap-table-head-bg: #eef3f8;
  --heatmap-row-hover-bg: #e0f2fe;
  --heatmap-cell-neutral-bg: rgba(49, 90, 128, 0.24);
  --heatmap-cell-neutral-text: #334155;
```

- [ ] **Step 4: Wire shell selectors to heatmap tokens**

In `apps/web/app/styles.css`, update these existing selectors to use the heatmap tokens.

Replace the `.heatmapShell` block with:

```css
.heatmapShell {
  background: var(--heatmap-shell-bg);
  display: flex;
  flex-direction: column;
  font-variant-numeric: tabular-nums;
  height: 100dvh;
  overflow: hidden;
  padding-bottom: 12px;
  padding-top: 12px;
  width: min(1780px, calc(100% - 24px));
}
```

Replace the `.heatmapSegmented button, .heatmapToolButton` block with:

```css
.heatmapSegmented button,
.heatmapToolButton {
  background: var(--heatmap-control-bg);
  cursor: pointer;
  padding: 0 12px;
}
```

Replace the `.heatmapSegmented-active, .heatmapSegmented button[aria-pressed="true"]` block with:

```css
.heatmapSegmented-active,
.heatmapSegmented button[aria-pressed="true"] {
  background: var(--heatmap-control-active-bg);
  border-color: var(--heatmap-control-active-border);
  color: var(--heatmap-control-active-text);
}
```

Replace the `.heatmapToolButton:hover, .heatmapSegmented button:hover` block with:

```css
.heatmapToolButton:hover,
.heatmapSegmented button:hover {
  border-color: rgba(var(--spot-reference-rgb), 0.38);
  color: var(--heatmap-control-hover-text);
}
```

Replace the `.heatmapTickerButtons button, .heatmapTickerOrderItem button` block with:

```css
.heatmapTickerButtons button,
.heatmapTickerOrderItem button {
  background: var(--heatmap-control-bg);
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--soft);
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  min-height: 28px;
}
```

Replace the `.heatmapTickerButtons button[aria-pressed="true"]` block with:

```css
.heatmapTickerButtons button[aria-pressed="true"] {
  background: var(--heatmap-control-active-bg);
  border-color: var(--heatmap-control-active-border);
  color: var(--heatmap-control-active-text);
}
```

Replace the `.heatmapTickerOrderItem` block with:

```css
.heatmapTickerOrderItem {
  background: var(--heatmap-control-bg);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  gap: 4px;
  min-height: 30px;
  padding: 2px 4px 2px 8px;
}
```

Replace the `.heatmapPanel` block with:

```css
.heatmapPanel {
  background: var(--heatmap-panel-bg);
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  box-shadow: var(--heatmap-panel-shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
```

Replace the `.heatmapPanelHeader` block with:

```css
.heatmapPanelHeader {
  align-items: center;
  background: var(--heatmap-panel-header-bg);
  border-bottom: 1px solid var(--line-soft);
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
  justify-content: space-between;
  min-height: 48px;
  padding: 8px 12px;
}
```

Replace the `.heatmapPanelSymbol` block with:

```css
.heatmapPanelSymbol {
  background: var(--heatmap-control-bg);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 6px;
  color: var(--text);
  cursor: default;
  font-size: 13px;
  font-weight: 900;
  min-height: 32px;
  padding: 0 12px;
}
```

Replace the `.heatmapTable th` block with:

```css
.heatmapTable th {
  background: var(--heatmap-table-head-bg);
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0;
  position: sticky;
  text-transform: uppercase;
  top: 0;
  z-index: 1;
}
```

Replace `.heatmapTable tbody tr:hover` with:

```css
.heatmapTable tbody tr:hover {
  background: var(--heatmap-row-hover-bg);
}
```

Add this block after `.heatmapStrike strong`:

```css
.heatmapStrike {
  background: var(--heatmap-strike-bg);
}
```

- [ ] **Step 5: Wire existing cell classes to the shared palette**

In `apps/web/app/styles.css`, replace all existing `.heatmapCell-positive`, `.heatmapCell-negative`, `.heatmapCell-neutral`, and `.heatmapCell-intensity-*` heatmap cell color blocks with this exact block:

```css
.heatmapCell-positive {
  color: var(--heatmap-positive-1-text);
}

.heatmapCell-negative {
  color: var(--heatmap-negative-1-text);
}

.heatmapCell-neutral {
  color: var(--heatmap-cell-neutral-text);
}

.heatmapCell-intensity-0 {
  background: var(--heatmap-cell-neutral-bg);
}

.heatmapCell-intensity-1 {
  background: var(--heatmap-cell-neutral-bg);
}

.heatmapCell-intensity-1.heatmapCell-positive {
  background: var(--heatmap-positive-1);
  color: var(--heatmap-positive-1-text);
}

.heatmapCell-intensity-2.heatmapCell-positive {
  background: var(--heatmap-positive-2);
  color: var(--heatmap-positive-2-text);
}

.heatmapCell-intensity-3.heatmapCell-positive {
  background: var(--heatmap-positive-3);
  color: var(--heatmap-positive-3-text);
}

.heatmapCell-intensity-4.heatmapCell-positive {
  background: var(--heatmap-positive-4);
  color: var(--heatmap-positive-4-text);
}

.heatmapCell-intensity-1.heatmapCell-negative {
  background: var(--heatmap-negative-1);
  color: var(--heatmap-negative-1-text);
}

.heatmapCell-intensity-2.heatmapCell-negative {
  background: var(--heatmap-negative-2);
  color: var(--heatmap-negative-2-text);
}

.heatmapCell-intensity-3.heatmapCell-negative {
  background: var(--heatmap-negative-3);
  color: var(--heatmap-negative-3-text);
}

.heatmapCell-intensity-4.heatmapCell-negative {
  background: var(--heatmap-negative-4);
  color: var(--heatmap-negative-4-text);
}
```

- [ ] **Step 6: Run CSS and heatmap regression tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/heatmapThemeStyles.test.ts tests/heatmapFormat.test.ts tests/ExposureHeatmap.test.tsx
```

Expected: PASS. The CSS contract should prove the shared cell palette is declared once and that light mode changes shell tokens only.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add apps/web/app/styles.css apps/web/tests/heatmapThemeStyles.test.ts
git commit -m "style: align heatmap theme palette"
```

---

### Task 3: Full Verification And Browser Flow

**Files:**
- No source files should be modified in this task.

- [ ] **Step 1: Run focused web tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExposureHeatmap.test.tsx tests/heatmapThemeStyles.test.ts tests/ThemeToggle.test.tsx tests/HeatmapPage.test.tsx tests/heatmapFormat.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm typecheck:web
```

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 3: Verify no backend files changed**

Run:

```bash
git diff --name-only origin/main...HEAD | rg '^(apps/api|services/collector)/' || true
```

Expected: no output. This confirms the theme work stayed frontend-only.

- [ ] **Step 4: Start or reuse the local app**

If port `3001` is already serving the app, reuse it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/heatmap
```

Expected: `200`.

If it is not serving, start it:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8001 pnpm --filter @gammascope/web dev -- -p 3001
```

Expected: Next.js dev server reports a local URL on port `3001`.

- [ ] **Step 5: Verify the browser flow with vercel:verification**

Use the in-app browser for `http://localhost:3001/heatmap` and verify this user story:

`The user toggles the global theme on Heatmap, the page shell switches dark/light while heatmap cell semantics stay stable, and the saved theme preference carries across Heatmap, Realtime, and Replay.`

Browser checks:

1. Open `/heatmap`.
2. Confirm the header includes the Theme switch.
3. Toggle to light mode.
4. Confirm `document.documentElement.dataset.theme` is `light`.
5. Confirm `localStorage.getItem("gammascope:theme")` is `light`.
6. Confirm visible heatmap panels still show saturated teal/green/yellow positive cells and blue/purple/violet negative cells.
7. Navigate to `/`.
8. Confirm the Realtime page is still in light mode.
9. Navigate to `/replay`.
10. Confirm the Replay page is still in light mode.
11. Toggle back to dark mode on Realtime or Replay.
12. Navigate back to `/heatmap`.
13. Confirm Heatmap is in dark mode and the cell palette still matches the shared semantic palette.
14. Check browser console errors and warnings.

Expected: no console errors, no failed heatmap API requests, and the theme state persists across all three tabs.

- [ ] **Step 6: Prepare completion summary**

Before reporting completion, capture:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: clean working tree on `codex/heatmap-theme-mode`, ahead of `origin/main` by the spec and implementation commits.

Report:

- Theme toggle added to Heatmap.
- Light/dark theme state shared across all three pages.
- Heatmap shell changes by theme.
- Heatmap cell palette is shared across themes.
- Focused tests and typecheck passed.
- Browser verification result.
