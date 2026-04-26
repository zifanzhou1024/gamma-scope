# GammaScope Live Snapshot Assembler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ingested collector events into a live-mode `AnalyticsSnapshot` so the latest snapshot API can reflect mock-live data after the collector publisher runs.

**Architecture:** Keep assembly in the FastAPI backend, close to the in-memory collector state and analytics core. The assembler reads latest collector health, contracts, underlying ticks, and option ticks, computes per-row custom IV/gamma/vanna with the existing Black-Scholes engine, and returns the existing `AnalyticsSnapshot` contract. If collector state is incomplete, `/api/spx/0dte/snapshot/latest` keeps returning the seeded replay fixture.

**Tech Stack:** FastAPI, generated collector and analytics contracts, Python analytics core, pytest/TestClient.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Pure live snapshot assembler from in-memory collector state.
- Snapshot route fallback: live snapshot when available, seeded replay otherwise.
- API tests proving published mock events change `/snapshot/latest` to `mode: live`.
- Contract validation through generated `AnalyticsSnapshot`.
- README note for checking the live snapshot after publishing mock events.

Out of scope:

- Postgres/Redis persistence.
- WebSocket fanout.
- Frontend data fetching from API.
- IBKR adapter.
- Multi-session state retention.

## File Structure

- Create: `apps/api/gammascope_api/ingestion/live_snapshot.py`
- Modify: `apps/api/gammascope_api/ingestion/collector_state.py`
- Modify: `apps/api/gammascope_api/routes/snapshot.py`
- Modify: `apps/api/tests/test_contract_endpoints.py`
- Modify: `README.md`

## Chunk 1: Pure Assembler

### Task 1: Add Live Snapshot API Test

**Files:**

- Modify: `apps/api/tests/test_contract_endpoints.py`
- Create: `apps/api/gammascope_api/ingestion/live_snapshot.py`

- [ ] **Step 1: Write failing test**

Add a test that publishes one health event, one underlying tick, one call/put contract pair, and one call/put option tick pair. Then assert:

- `GET /api/spx/0dte/snapshot/latest` returns `mode == "live"`.
- the result validates with generated `AnalyticsSnapshot`.
- `rows` has two rows.
- rows include `open_interest`, `custom_iv`, `custom_gamma`, and `custom_vanna`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_latest_snapshot_prefers_ingested_live_snapshot -q
```

Expected: failure because snapshot route still returns seeded replay.

- [ ] **Step 3: Implement assembler**

Create `build_live_snapshot(state: CollectorState) -> dict | None` that:

- returns `None` when health, underlying, contracts, or option ticks are missing.
- uses latest underlying spot/mark.
- derives tau from latest tick time to expiry close.
- computes rows with `calculate_row_analytics`.
- includes IBKR comparison fields from option ticks.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_latest_snapshot_prefers_ingested_live_snapshot -q
```

Expected: test passes.

## Chunk 2: Route and Smoke Docs

### Task 2: Integrate Latest Snapshot Route

**Files:**

- Modify: `apps/api/gammascope_api/routes/snapshot.py`
- Modify: `README.md`

- [ ] **Step 1: Add fallback behavior**

Update `/api/spx/0dte/snapshot/latest` to call `build_live_snapshot(collector_state)` and return seeded replay only when it returns `None`.

- [ ] **Step 2: Document local test**

Document:

```bash
pnpm dev:api
pnpm collector:publish-mock -- --api http://127.0.0.1:8000 --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210
curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | python -m json.tool
```

- [ ] **Step 3: Run focused API tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py -q
```

Expected: API endpoint tests pass.

## Chunk 3: Verification and Commit

### Task 3: Verify Assembler Slice

**Files:**

- Modify: `docs/superpowers/plans/2026-04-24-gammascope-live-snapshot-assembler.md`

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm contracts:validate
pnpm test:collector
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
```

Expected: all checks pass.

- [ ] **Step 2: Commit assembler slice**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-24-gammascope-live-snapshot-assembler.md apps/api/gammascope_api apps/api/tests
git commit -m "feat: assemble live snapshot from collector state"
```
