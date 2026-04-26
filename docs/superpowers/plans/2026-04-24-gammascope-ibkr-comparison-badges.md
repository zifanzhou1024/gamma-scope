# GammaScope IBKR Comparison Badges Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact IBKR comparison context to the option chain IV and gamma cells while keeping custom analytics primary.

**Architecture:** Keep the comparison behavior in pure dashboard metric helpers and render it as secondary inline content inside the existing option-chain cells. Preserve the current strike grouping and All/Calls/Puts filtering behavior, with only minimal table styling additions.

**Tech Stack:** Next.js, React, TypeScript, Vitest, CSS.

---

### Task 1: Helper Behavior

**Files:**
- Modify: `apps/web/lib/dashboardMetrics.ts`
- Test: `apps/web/tests/dashboardMetrics.test.ts`

- [ ] Add failing Vitest coverage for IV diff basis-point formatting, gamma diff compact signed decimal formatting, and comparison status labels/tones including missing/null and a non-ok status.
- [ ] Run `pnpm --filter @gammascope/web test -- tests/dashboardMetrics.test.ts` and confirm RED.
- [ ] Implement minimal exported helpers in `dashboardMetrics.ts`.
- [ ] Re-run the helper test and confirm GREEN.

### Task 2: Option Chain Rendering

**Files:**
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `apps/web/tests/DashboardView.test.tsx`

- [ ] Add failing static-render coverage proving default/all mode shows IBKR IV and gamma comparison context.
- [ ] Add failing coverage proving calls-only hides put comparison context and puts-only hides call comparison context.
- [ ] Run `pnpm --filter @gammascope/web test -- tests/DashboardView.test.tsx` and confirm RED.
- [ ] Render compact secondary comparison lines/chips in IV and gamma cells, falling back to compact status chips for missing/non-ok context.
- [ ] Add minimal dense dark-table CSS for comparison lines and chips.
- [ ] Re-run DashboardView tests and confirm GREEN.

### Task 3: Verification

**Files:**
- Verify: focused web tests and feasible typecheck.

- [ ] Run focused web tests for `dashboardMetrics.test.ts` and `DashboardView.test.tsx`.
- [ ] Run `pnpm --filter @gammascope/web typecheck` if feasible.
- [ ] Self-review changed files for scope, schema safety, and unrelated churn.
