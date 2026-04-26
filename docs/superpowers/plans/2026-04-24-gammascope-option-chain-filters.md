# GammaScope Option Chain Filters Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development`. Implementers MUST use `superpowers:test-driven-development` for every code change. The controller MUST use `superpowers:verification-before-completion` before completion claims or commits.

## Goal

Make the existing option-chain filter controls functional so a reviewer can switch the chain table between all contracts, calls only, and puts only.

## Scope

In scope:

- Replace visual-only option-chain filter chips with accessible button controls.
- Add a small pure filter helper with tests.
- Keep strike spine visible in every mode.
- In `calls` mode, hide put-side columns/cells and keep call-side data visible.
- In `puts` mode, hide call-side columns/cells and keep put-side data visible.
- Keep default mode as `all`.
- Keep existing chain styling and table structure unless a minimal class/ARIA change is needed.

Out of scope:

- Backend changes.
- Persisting the filter in saved views.
- Search, strike-window filtering, sorting, or pagination.
- Redesigning the option chain.

## File Structure

- Modify `apps/web/lib/dashboardMetrics.ts`
- Modify `apps/web/tests/dashboardMetrics.test.ts`
- Modify `apps/web/components/DashboardView.tsx`
- Modify `apps/web/tests/DashboardView.test.tsx`
- Modify `apps/web/app/styles.css`

## Task 1: Functional Option Chain Filters

Follow TDD:

1. Add failing helper tests for `filterChainRowsBySide(rows, side)` where `side` is `all`, `calls`, or `puts`.
2. Verify RED with:

   ```bash
   pnpm --filter @gammascope/web test -- dashboardMetrics.test.ts DashboardView.test.tsx
   ```

3. Implement the minimal helper in `dashboardMetrics.ts`.
4. Update `DashboardView` so the filter chips become buttons with `aria-pressed` state and client-side state.
5. Render call-side cells only for `all` or `calls`, and put-side cells only for `all` or `puts`; keep the strike column visible.
6. Add/extend dashboard view tests proving the controls render as buttons and calls/puts modes can be represented by static props or exported helpers.
7. Verify GREEN with the same targeted web test command.

## Acceptance Criteria

- All/Calls/Puts are buttons, not inert text.
- `All` is selected by default.
- Switching to calls hides put columns/cells.
- Switching to puts hides call columns/cells.
- Option chain remains readable and responsive.
- Existing replay, scenario, and saved view panels remain unaffected.
