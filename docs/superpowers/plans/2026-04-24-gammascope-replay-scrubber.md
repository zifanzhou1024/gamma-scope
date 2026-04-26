# Replay Scrubber Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a replay timeline scrubber so the seeded demo session has multiple timestamps and the dashboard can load a selected replay snapshot.

**Architecture:** Keep replay demo data deterministic and local. The FastAPI replay route should expose one seed session with several generated snapshots and return the nearest snapshot for a requested `at` timestamp. The Next dashboard should derive timestamp options from the session metadata, render a compact range scrubber, and pass the selected timestamp through the existing replay proxy route.

**Tech Stack:** FastAPI, Python, Next.js App Router, React, TypeScript, Vitest, pytest.

---

## File Structure

- Modify `apps/api/gammascope_api/routes/replay.py`
  - Replace the single static snapshot response with a small deterministic replay series built from the seeded analytics fixture.
  - Keep API shape unchanged: `GET /api/spx/0dte/replay/sessions` and `GET /api/spx/0dte/replay/snapshot?session_id=&at=`.
- Modify `apps/api/tests/test_contract_endpoints.py`
  - Add coverage for replay session span/count and `at` timestamp selection.
- Modify `apps/web/lib/clientReplaySource.ts`
  - Add pure helpers for deriving replay timestamp options and clamping selected scrubber indexes from session metadata.
- Modify `apps/web/tests/clientReplaySource.test.ts`
  - Add helper tests for timestamp generation, one-snapshot sessions, and invalid indexes.
- Modify `apps/web/components/ReplayPanel.tsx`
  - Add a timeline range input, selected timestamp label, and disabled state for single-snapshot sessions.
- Modify `apps/web/components/LiveDashboard.tsx`
  - Track selected replay index and selected timestamp, initialize to the latest available replay timestamp, and include `at` in replay snapshot requests.
- Modify `apps/web/tests/LiveDashboard.test.tsx`
  - Add pure helper tests for replay request timestamp selection.
- Modify `apps/web/app/styles.css`
  - Add compact scrubber styling consistent with the current dashboard controls.

## Task 1: Seeded replay timeline and dashboard scrubber

**Files:**
- Modify: `apps/api/gammascope_api/routes/replay.py`
- Modify: `apps/api/tests/test_contract_endpoints.py`
- Modify: `apps/web/lib/clientReplaySource.ts`
- Modify: `apps/web/tests/clientReplaySource.test.ts`
- Modify: `apps/web/components/ReplayPanel.tsx`
- Modify: `apps/web/components/LiveDashboard.tsx`
- Modify: `apps/web/tests/LiveDashboard.test.tsx`
- Modify: `apps/web/app/styles.css`

- [ ] **Step 1: Write failing backend tests**

Add tests proving:
- `/api/spx/0dte/replay/sessions` returns the seed session with `snapshot_count` greater than 1 and different `start_time` / `end_time`.
- `/api/spx/0dte/replay/snapshot` returns different `snapshot_time` / `spot` values when called with different valid `at` timestamps.
- Unknown replay sessions still return an empty replay snapshot with `coverage_status: "empty"` and no rows.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_contract_endpoints.py -q
```

Expected: FAIL because the replay route currently exposes one timestamp only.

- [ ] **Step 2: Implement minimal backend replay series**

In `apps/api/gammascope_api/routes/replay.py`, add local helpers:

- `seed_replay_snapshots() -> list[dict]`
- `nearest_replay_snapshot(snapshots: list[dict], at: str | None) -> dict`
- a small deterministic transformation that deep-copies the seed fixture into 4 snapshots, e.g. timestamps around `2026-04-23T15:30:00Z`, `15:40:00Z`, `15:50:00Z`, `16:00:00Z`.

Keep transforms conservative:
- `mode` stays `replay`
- `session_id`, `symbol`, and `expiry` stay stable
- `spot`, `forward`, `freshness_ms`, `snapshot_time`, and at least `custom_iv`, `custom_gamma`, `custom_vanna`, `iv_diff`, and `gamma_diff` change deterministically enough for charts/tables to visibly update
- output remains compatible with the analytics snapshot schema

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_contract_endpoints.py -q
```

Expected: PASS.

- [ ] **Step 3: Write failing web helper and dashboard tests**

Add tests proving:
- `replayTimestampOptions(session)` returns evenly spaced ISO timestamp options from `start_time`, `end_time`, and `snapshot_count`.
- one-snapshot sessions return a single timestamp.
- invalid selected indexes clamp to the available range.
- `createReplaySnapshotRequest("session", "time")` includes `{ session_id, at }`.

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts LiveDashboard.test.tsx
```

Expected: FAIL because the helpers / `at` request behavior do not exist yet.

- [ ] **Step 4: Implement minimal web scrubber plumbing**

In `apps/web/lib/clientReplaySource.ts`:
- export `replayTimestampOptions(session: ReplaySession): string[]`
- export `clampReplayIndex(index: number, session: ReplaySession): number`
- keep invalid or degenerate sessions fail-closed to `[session.end_time]` or `[session.start_time]`

In `apps/web/components/LiveDashboard.tsx`:
- maintain `selectedReplayIndex`
- initialize to the latest snapshot index for the first loaded session
- derive `selectedReplayTime`
- update `createReplaySnapshotRequest` so it accepts `selectedSessionId` and optional selected timestamp
- pass selected time into `loadClientReplaySnapshot`

In `apps/web/components/ReplayPanel.tsx`:
- accept `snapshotTimes`, `selectedSnapshotIndex`, `selectedSnapshotTime`, and `onSelectSnapshotIndex`
- render `<input type="range">` with stable min/max/value
- show a compact timestamp label and a position label such as `4 / 4`
- disable the scrubber while sessions or replay are loading

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts LiveDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Style and focused verification**

Add CSS for the replay timeline controls in `apps/web/app/styles.css`.

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts replayRoute.test.ts LiveDashboard.test.tsx DashboardView.test.tsx
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_contract_endpoints.py -q
pnpm typecheck:web
```

Expected: all commands PASS.

- [ ] **Step 6: Review and final verification**

After implementation, run spec compliance review first, then code quality review.

Final controller verification before commit:

```bash
pnpm test
pnpm test:collector
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
pnpm --filter @gammascope/web build
git diff --check
```

Browser smoke:
- Open `http://localhost:3000/`.
- Wait for replay sessions to load.
- Move the replay scrubber away from the latest timestamp.
- Click `Load replay`.
- Confirm the displayed replay session uses the selected replay timestamp and the spot/analytics change.
- Click `Return to live` and confirm live mode/session returns.
