# GammaScope Live Scenario Base Plan

## Goal

Make `POST /api/spx/0dte/scenario` compute scenarios from the current local live snapshot when the request targets the active live session. Keep the seeded replay snapshot as the fallback for replay demos and when no usable live snapshot exists.

## Context

- `GET /api/spx/0dte/snapshot/latest` already prefers `build_live_snapshot(collector_state)` and falls back to `analytics-snapshot.seed.json`.
- `POST /api/spx/0dte/scenario` currently always uses `analytics-snapshot.seed.json`.
- Scenario math already lives in `gammascope_api.analytics.scenario.create_scenario_snapshot`.
- Tests for collector ingestion, live snapshot assembly, and seeded scenario behavior live in `apps/api/tests/test_contract_endpoints.py`.

## Task 1: Select Live Snapshot For Matching Scenario Requests

Follow TDD:

1. Add a failing API test proving that, after collector health, underlying, contracts, and option ticks are ingested, a scenario request for `session_id: live-spx-local-mock` is based on the live snapshot rather than the seed fixture.
2. The test must validate the response with the generated `AnalyticsSnapshot` model.
3. The test must assert:
   - response status is 200
   - `mode` is `scenario`
   - `session_id` is `live-spx-local-mock`
   - shifted `spot` equals live spot plus `spot_shift_points`
   - returned rows come from the live contracts, not the 34-row seed fixture
   - `scenario_params` echoes the request shifts
4. Run the test and confirm it fails because the scenario endpoint still uses the seed snapshot.
5. Update the route minimally so it uses `build_live_snapshot(collector_state)` when a live snapshot exists and its `session_id` matches the request `session_id`; otherwise keep the seeded fallback.
6. Re-run the targeted test and the existing API tests.

## Acceptance Criteria

- Live scenario requests use current local collector state.
- Seeded replay scenario requests keep existing behavior.
- The endpoint does not invent new request fields, persistence, auth, or UI behavior.
- Existing latest snapshot and seeded scenario tests still pass.
