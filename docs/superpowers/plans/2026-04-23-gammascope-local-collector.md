# GammaScope Local Collector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first local collector service slice: a tested, mockable SPX 0DTE event producer that emits normalized collector events shaped for the future IBKR live path.

**Architecture:** Start with a separate Python service under `services/collector` so the IBKR edge can evolve independently from the FastAPI backend. The first implementation is mock-first: it emits `CollectorHealth`, `ContractDiscovered`, `UnderlyingTick`, and `OptionTick` dictionaries that validate against the generated collector-event contract, then adds a JSONL CLI for local dry runs. Real IBKR/TWS connectivity stays behind a future adapter interface and is not required for this slice.

**Tech Stack:** Python 3.11+, standard-library dataclasses/argparse/json, pytest, generated Pydantic collector contracts from `apps/api`.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Local collector service package scaffold.
- Contract-shaped event factory functions for health, contract discovery, underlying ticks, and option ticks.
- Deterministic mock SPX 0DTE session source for local testing.
- CLI that emits one mock collector cycle as newline-delimited JSON.
- Tests validating emitted events against the generated collector-event Pydantic model.
- README command for running the mock collector.

Out of scope:

- Real IBKR/TWS network connection.
- SPX contract lookup through IBKR.
- Backend ingestion and persistence.
- WebSocket streaming.
- Live dashboard subscription.

## File Structure

- Create: `services/collector/gammascope_collector/__init__.py`
- Create: `services/collector/gammascope_collector/events.py`
- Create: `services/collector/gammascope_collector/mock_source.py`
- Create: `services/collector/gammascope_collector/cli.py`
- Create: `services/collector/tests/test_events.py`
- Create: `services/collector/tests/test_mock_source.py`
- Modify: `README.md`
- Modify: `package.json`

## Chunk 1: Collector Event Builders

### Task 1: Add Contract Validation Tests

**Files:**

- Create: `services/collector/tests/test_events.py`
- Create: `services/collector/gammascope_collector/events.py`

- [ ] **Step 1: Write failing tests**

Add tests that import:

```python
from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.events import (
    contract_discovered_event,
    health_event,
    option_tick_event,
    underlying_tick_event,
)
```

The tests should assert:

- every builder returns a dictionary that `CollectorEvents.model_validate(...)` accepts.
- all emitted events include `schema_version == "1.0.0"` and `source == "ibkr"`.
- `contract_discovered_event(...)` produces stable `contract_id` strings with symbol, expiry, right, and strike.
- `option_tick_event(...)` marks crossed quotes as `quote_status == "crossed"` when `bid > ask`.
- `underlying_tick_event(...)` derives `mark` from bid/ask when both are present.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_events.py -q
```

Expected: import failure because `gammascope_collector.events` does not exist yet.

- [ ] **Step 3: Implement event builders**

Create `services/collector/gammascope_collector/events.py` with small pure functions:

- `utc_now()`
- `health_event(...)`
- `contract_id(symbol, expiry, right, strike)`
- `contract_discovered_event(...)`
- `underlying_tick_event(...)`
- `option_tick_event(...)`
- private quote-status helpers.

Keep output as plain dictionaries so it can be serialized, posted to the backend, or validated without collector-specific classes.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_events.py -q
```

Expected: tests pass.

## Chunk 2: Mock SPX 0DTE Source

### Task 2: Add Deterministic Mock Source Tests

**Files:**

- Create: `services/collector/tests/test_mock_source.py`
- Create: `services/collector/gammascope_collector/mock_source.py`

- [ ] **Step 1: Write failing tests**

Add tests that call:

```python
from gammascope_collector.mock_source import build_mock_cycle
```

The tests should assert:

- the cycle starts with a connected health event.
- the cycle includes one underlying tick.
- the cycle includes call and put contract-discovery events for every strike.
- the cycle includes call and put option ticks for every strike.
- all events validate with `CollectorEvents.model_validate(...)`.

Use `spot=5200.25`, `expiry="2026-04-23"`, and strikes `[5190, 5200, 5210]`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_mock_source.py -q
```

Expected: import failure because `gammascope_collector.mock_source` does not exist yet.

- [ ] **Step 3: Implement mock source**

Create `services/collector/gammascope_collector/mock_source.py` with:

- `build_mock_cycle(...) -> list[dict[str, object]]`
- deterministic bid/ask/mid/open-interest/model values based on strike distance.
- default `collector_id="local-dev"` and `session_id="live-spx-local-mock"`.

Do not read files or call the network in this source.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_events.py services/collector/tests/test_mock_source.py -q
```

Expected: collector tests pass.

## Chunk 3: Local JSONL CLI

### Task 3: Add CLI Smoke Test and Script

**Files:**

- Create: `services/collector/gammascope_collector/cli.py`
- Modify: `services/collector/tests/test_mock_source.py`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write failing CLI test**

Add a test that invokes:

```python
from gammascope_collector.cli import main
```

Capture stdout for:

```python
main(["--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5190,5200,5210"])
```

Assert it emits newline-delimited JSON and every line validates with `CollectorEvents.model_validate(...)`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_mock_source.py::test_cli_emits_jsonl_cycle -q
```

Expected: import failure because `gammascope_collector.cli` does not exist yet.

- [ ] **Step 3: Implement CLI**

Create `services/collector/gammascope_collector/cli.py` with an argparse `main(argv=None)` function that:

- parses `--spot`, `--expiry`, and `--strikes`.
- calls `build_mock_cycle`.
- writes each event as compact sorted JSON on its own line.

Add root package scripts:

```json
"collector:mock": "PYTHONPATH=services/collector:apps/api python3 -m gammascope_collector.cli",
"test:collector": "PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests -q"
```

Document:

```bash
pnpm collector:mock -- --spot 5200.25 --expiry 2026-04-23 --strikes 5190,5200,5210
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm test:collector
```

Expected: collector tests pass.

## Chunk 4: Full Verification and Commit

### Task 4: Verify Local Collector Slice

**Files:**

- Modify: `docs/superpowers/plans/2026-04-23-gammascope-local-collector.md`

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm contracts:validate
pnpm test:collector
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api/analytics apps/api/tests
```

Expected: all checks pass.

- [ ] **Step 2: Commit local collector slice**

Run:

```bash
git add README.md package.json docs/superpowers/plans/2026-04-23-gammascope-local-collector.md services/collector
git commit -m "feat: add mock local collector"
```
