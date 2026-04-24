# GammaScope Collector Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local bridge command that publishes the mock SPX 0DTE collector cycle into the FastAPI collector ingestion endpoint.

**Architecture:** Keep the bridge in the collector service so it can later be reused by the real IBKR adapter. The publisher takes normalized event dictionaries, POSTs them one at a time to the backend ingestion endpoint, and returns a small summary; the CLI builds the existing deterministic mock cycle and uses the same publisher. This remains a local dev tool: no auth, retry queue, persistence, or streaming loop yet.

**Tech Stack:** Python standard library `urllib`, argparse, pytest, existing collector mock source, existing FastAPI ingestion endpoint.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Publisher helper for POSTing normalized collector events to `/api/spx/0dte/collector/events`.
- CLI command that builds the mock collector cycle and publishes it.
- Package script for local use.
- Tests with a fake HTTP sender; no real server required.
- README command showing the local bridge workflow.

Out of scope:

- Real IBKR adapter.
- Long-running streaming loop.
- Retries/backoff.
- Authenticated collector identity.
- Backend persistence or snapshot assembly.

## File Structure

- Create: `services/collector/gammascope_collector/publisher.py`
- Create: `services/collector/tests/test_publisher.py`
- Modify: `package.json`
- Modify: `README.md`

## Chunk 1: Publisher Core

### Task 1: Add Publisher Tests

**Files:**

- Create: `services/collector/tests/test_publisher.py`
- Create: `services/collector/gammascope_collector/publisher.py`

- [ ] **Step 1: Write failing tests**

Add tests that:

- call `collector_event_endpoint("http://127.0.0.1:8000")` and expect `http://127.0.0.1:8000/api/spx/0dte/collector/events`.
- call `publish_events(events, api_base=..., post_json=fake_post)` and assert every event is posted to that endpoint.
- assert `publish_events` returns accepted count and event types from backend responses.
- assert `publish_events` raises `PublishError` when the backend response does not include `accepted: true`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_publisher.py -q
```

Expected: import failure because `gammascope_collector.publisher` does not exist yet.

- [ ] **Step 3: Implement publisher**

Create `publisher.py` with:

- `collector_event_endpoint(api_base: str) -> str`
- `PublishSummary` dataclass
- `PublishError`
- `publish_events(events, api_base, post_json=None)`
- private `_post_json(endpoint, event)` using `urllib.request`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_publisher.py -q
```

Expected: publisher tests pass.

## Chunk 2: Mock Publisher CLI

### Task 2: Add CLI and Package Script

**Files:**

- Modify: `services/collector/gammascope_collector/publisher.py`
- Modify: `services/collector/tests/test_publisher.py`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write failing CLI tests**

Add tests that:

- call `main(["--api", "http://testserver", "--spot", "5200.25", "--expiry", "2026-04-23", "--strikes", "5200"], post_json=fake_post)`.
- assert stdout is JSON with `accepted_count == 6`.
- assert the CLI accepts pnpm's forwarded `--` separator.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_publisher.py::test_publish_mock_cli_prints_summary -q
```

Expected: failure because the CLI entry point does not exist yet.

- [ ] **Step 3: Implement CLI and script**

Add `main(argv=None, post_json=None)` to `publisher.py`. It should parse:

- `--api`, default `http://127.0.0.1:8000`
- `--spot`
- `--expiry`
- `--strikes`

It builds `build_mock_cycle(...)`, publishes it, and prints summary JSON.

Add root script:

```json
"collector:publish-mock": "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.publisher"
```

Document:

```bash
pnpm dev:api
pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-23 --strikes 5190,5200,5210
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm test:collector
```

Expected: collector tests pass.

## Chunk 3: Verification and Commit

### Task 3: Verify Bridge Slice

**Files:**

- Modify: `docs/superpowers/plans/2026-04-24-gammascope-collector-bridge.md`

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

- [ ] **Step 2: Commit bridge slice**

Run:

```bash
git add README.md package.json docs/superpowers/plans/2026-04-24-gammascope-collector-bridge.md services/collector
git commit -m "feat: add mock collector publisher"
```
