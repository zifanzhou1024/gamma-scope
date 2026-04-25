# GammaScope Collector Health Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface local FastAPI collector health in the Next.js dashboard status area.

**Architecture:** Add a web-side CollectorHealth guard and client loader, proxy the FastAPI status endpoint through a no-store Next.js route, and pass the loaded status into the existing live dashboard view. Keep health failures non-blocking so snapshot rendering and polling continue.

**Tech Stack:** Next.js route handlers, React client components, Vitest, workspace contracts from `@gammascope/contracts`.

---

## Scope

- Create `apps/web/lib/clientCollectorStatusSource.ts` for `CollectorHealth` validation and a no-store client fetcher.
- Create `apps/web/app/api/spx/0dte/status/route.ts` to proxy `${GAMMASCOPE_API_BASE_URL || "http://127.0.0.1:8000"}/api/spx/0dte/status`.
- Extend `apps/web/components/LiveDashboard.tsx` to load and refresh collector health while live snapshot polling is active.
- Extend `apps/web/components/DashboardView.tsx` and `apps/web/app/styles.css` with compact collector, IBKR account mode, and message context near the existing status/session area.
- Add focused Vitest coverage for helper behavior, route behavior, static dashboard rendering, and any new polling/apply helper.

## Acceptance Criteria

- [x] RED tests are written and run before production implementation.
- [x] `CollectorHealth` shape is validated without changing generated contracts.
- [x] Client loader requests `/api/spx/0dte/status` with `cache: "no-store"` and `Accept: "application/json"`.
- [x] Route handler validates upstream payloads and returns no-store JSON on success.
- [x] Route handler returns no-store 502 JSON for upstream non-OK, invalid payloads, and thrown fetches.
- [x] Live dashboard health loading does not block or clear snapshot rendering on failure.
- [x] Compact health UI appears without adding a large new card.
- [x] GREEN tests and typecheck are captured after implementation.

## TDD Evidence

- Initial RED: `pnpm --filter @gammascope/web test tests/clientCollectorStatusSource.test.ts tests/statusRoute.test.ts tests/DashboardView.test.tsx tests/LiveDashboard.test.tsx` failed as expected because the client helper was missing, the status route was missing, `shouldPollCollectorHealth` was missing, and `DashboardView` did not render Collector context.
- Initial GREEN: the same focused 4-file test command passed with 32 tests; `pnpm --filter @gammascope/web typecheck` passed; `pnpm test` passed, including 109 web tests.
- Spec-fix RED: `pnpm --filter @gammascope/web test tests/clientCollectorStatusSource.test.ts tests/statusRoute.test.ts` failed as expected with 6 failures because the guard and route accepted an extra property, empty `collector_id`, and invalid timestamps.
- Spec-fix GREEN: the same focused helper/route test command passed with 2 files and 16 tests; `pnpm --filter @gammascope/web typecheck` passed; `git diff --check` passed.
- Calendar-date RED: the same focused helper/route test command failed as expected with 2 failures because `2026-02-31T00:00:00Z` was accepted.
- Calendar-date GREEN: the same focused helper/route test command passed with 2 files and 17 tests; the full web-focused collector/status/dashboard set passed with 39 tests; `pnpm --filter @gammascope/web typecheck` passed.
