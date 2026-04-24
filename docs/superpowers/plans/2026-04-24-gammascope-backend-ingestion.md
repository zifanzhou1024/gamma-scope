# GammaScope Backend Ingestion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local backend ingestion path for normalized collector events so the mock collector can feed validated live-shaped state into FastAPI.

**Architecture:** Keep this slice in-memory and contract-first. The ingestion route accepts one generated `CollectorEvents` payload at a time, validates it through the generated Pydantic root model, stores the latest health/underlying/option/contract state in a small process-local store, and exposes a summary endpoint for local smoke tests. Persistent storage, analytics snapshot assembly, and WebSocket fanout remain future slices.

**Tech Stack:** FastAPI, Pydantic generated collector contracts, Python in-memory store, pytest/TestClient.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Collector event ingestion route.
- Process-local collector state store.
- Latest collector state summary route.
- Status route fallback that returns ingested health when available, seed fixture otherwise.
- API tests for event acceptance, contract validation rejection, state summary, and status fallback.
- README example showing how to pipe mock collector JSONL into the API later.

Out of scope:

- Batch ingestion.
- Persistent storage.
- Snapshot assembly from ticks.
- Redis/Postgres.
- WebSocket streaming.
- Auth for private collector identity.

## File Structure

- Create: `apps/api/gammascope_api/ingestion/__init__.py`
- Create: `apps/api/gammascope_api/ingestion/collector_state.py`
- Create: `apps/api/gammascope_api/routes/collector.py`
- Modify: `apps/api/gammascope_api/main.py`
- Modify: `apps/api/gammascope_api/routes/status.py`
- Modify: `apps/api/tests/test_contract_endpoints.py`
- Modify: `README.md`

## Chunk 1: In-Memory Collector State

### Task 1: Add Collector State Tests

**Files:**

- Modify: `apps/api/tests/test_contract_endpoints.py`
- Create: `apps/api/gammascope_api/ingestion/collector_state.py`

- [ ] **Step 1: Write failing tests**

Add API tests that:

- POST a `CollectorHealth` event to `/api/spx/0dte/collector/events`.
- Assert the response is `{"accepted": true, "event_type": "CollectorHealth", ...}`.
- Assert `GET /api/spx/0dte/collector/state` shows one ingested health event and zero contracts/options.
- Assert `GET /api/spx/0dte/status` returns the ingested health event instead of the seed fixture.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_collector_ingest_accepts_health_event -q
```

Expected: 404 because the collector route does not exist yet.

- [ ] **Step 3: Implement collector state and route**

Create a `CollectorState` class with:

- `clear()`
- `ingest(event: CollectorEvents) -> str`
- `summary() -> dict[str, object]`
- `latest_health() -> dict[str, object] | None`

Create `routes/collector.py` with:

- `POST /api/spx/0dte/collector/events`
- `GET /api/spx/0dte/collector/state`

Wire it into `main.py`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_collector_ingest_accepts_health_event -q
```

Expected: test passes.

## Chunk 2: Contract Event Coverage

### Task 2: Validate Contract, Underlying, and Option Events

**Files:**

- Modify: `apps/api/tests/test_contract_endpoints.py`
- Modify: `apps/api/gammascope_api/ingestion/collector_state.py`

- [ ] **Step 1: Write failing tests**

Add tests that:

- POST a `ContractDiscovered`, `UnderlyingTick`, and `OptionTick`.
- Assert summary counts become `contracts_count == 1`, `underlying_ticks_count == 1`, and `option_ticks_count == 1`.
- Assert invalid collector payloads return HTTP 422.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_collector_ingest_tracks_contract_underlying_and_option_events apps/api/tests/test_contract_endpoints.py::test_collector_ingest_rejects_invalid_payload -q
```

Expected: failures until all event classes are tracked and FastAPI validation is wired.

- [ ] **Step 3: Implement event-specific state updates**

Update `CollectorState.ingest` to store:

- latest health by collector id.
- discovered contracts by `contract_id`.
- latest underlying ticks by session id.
- latest option ticks by contract id.

Expose counts and `last_event_time` in `summary()`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py -q
```

Expected: API endpoint tests pass.

## Chunk 3: Docs and Verification

### Task 3: Document and Verify

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add README note**

Document the local ingestion endpoint and explain that events are in-memory until the persistence slice.

- [ ] **Step 2: Run full checks**

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

- [ ] **Step 3: Commit backend ingestion slice**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-24-gammascope-backend-ingestion.md apps/api/gammascope_api apps/api/tests
git commit -m "feat: add collector ingestion endpoint"
```
