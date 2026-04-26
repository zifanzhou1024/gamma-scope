# GammaScope SPX 0DTE Contract Discovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real IBKR SPX 0DTE contract discovery command that requests SPX/SPXW option metadata, filters the target expiry and strike window, resolves IBKR contract IDs, and emits `ContractDiscovered` events.

**Architecture:** Add a collector module with pure filtering/event-building logic plus an injectable discovery adapter for tests. The real adapter should lazy-import official `ibapi`, reuse the connection/handshake lifecycle pattern, request SPX underlying contract details, optionally request spot, request option parameters, resolve candidate contracts through `reqContractDetails`, and disconnect in all paths. The CLI should print discovered events by default and publish them to the existing collector ingestion API with `--publish`.

**Tech Stack:** Python 3.11+, pytest, official IBKR `ibapi`, existing GammaScope collector event contracts, FastAPI ingestion.

---

## Owned Files

- Create: `services/collector/gammascope_collector/ibkr_contracts.py`
- Create: `services/collector/tests/test_ibkr_contracts.py`
- Modify: `package.json`
- Modify: `README.md`
- Modify: this plan file with RED/GREEN/verification evidence

## Task: SPX 0DTE Contract Discovery

- [x] Write RED tests for pure expiry normalization, strike-window selection, SPXW-over-SPX fallback, contract event validation, CLI publish/non-publish behavior, missing `ibapi`, adapter disconnect on failures, and real adapter callback handling using fake `ibapi` classes.
- [x] Run focused tests and capture the expected RED failure before production code exists.
- [x] Implement minimal discovery config, adapter protocol, pure filtering helpers, event builder, lazy real `ibapi` adapter, discovery runner, and CLI.
- [x] Add `collector:ibkr-contracts` root script.
- [x] Document the discovery command, including `--spot`, `--expiry`, `--strike-window-points`, `--max-strikes`, and the weekend/non-0DTE behavior.
- [x] Run the requested focused tests, collector suite, and lint checks for handoff.
- [x] Run final parent verification, live IBKR smoke checks, and commit.

## Behavioral Decisions

- Default target expiry is the local date (`date.today()`), formatted as IBKR `YYYYMMDD` for API filtering and `YYYY-MM-DD` for GammaScope events.
- `--expiry YYYY-MM-DD` overrides the default so the command can be tested outside market days.
- `--spot` overrides live spot lookup. If omitted, the real adapter requests SPX market data and uses last, midpoint, mark, or close in that order.
- Strike filtering defaults to `spot +/- 100` index points and optional `--max-strikes` keeps the nearest strikes to spot before resolving call/put contracts.
- Query both `SPXW` and `SPX` option metadata. Prefer `SPXW` if same-expiry metadata is available, and fall back to `SPX` when it is not. This avoids duplicate `contract_id` collisions in the current event schema.
- Emit one `ContractDiscovered` event for each resolved call and put contract. If no same-day expiry exists, print or publish no contract events and include `contracts_count: 0` in the CLI summary.

## Evidence

- RED: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py -q` exited 2 before production code existed with `ModuleNotFoundError: No module named 'gammascope_collector.ibkr_contracts'`.
- Additional RED: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py::test_cli_handles_discovery_timeout_as_error_json -q` failed before CLI timeout handling with uncaught `IbkrContractDiscoveryTimeout: timed out waiting for nextValidId`.
- Additional GREEN: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py::test_cli_handles_discovery_timeout_as_error_json -q` passed with `1 passed in 0.08s`.
- GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py -q` passed with `12 passed in 0.14s`.
- GREEN collector suite: `pnpm test:collector` passed with `77 passed in 0.14s`.
- GREEN lint: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- Script smoke: `pnpm collector:ibkr-contracts -- --help` printed the contract discovery CLI help successfully.
- Additional package script check after editing `package.json`: `pnpm test:scripts` passed with `1` Node test passing.
- Live IBKR smoke was not run in this subtask; current date is Saturday 2026-04-25, and the parent agent will perform any live verification/commit.
- Review-fix RED: after adding blocker regression tests, `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py -q` failed with `7 failed, 13 passed`, covering metadata merging, market-data error handling, snapshot end handling, informational errors, duplicate conId dedupe, and ambiguous conId rejection.
- Review-fix GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py -q` passed with `20 passed in 0.08s`.
- Review-fix GREEN collector suite: `pnpm test:collector` passed with `85 passed in 0.15s`.
- Review-fix GREEN lint: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- Final focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_contracts.py -q` passed with `20 passed`.
- Final collector suite: `pnpm test:collector` passed with `85 passed`.
- Final API suite: `PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q` passed with `28 passed`.
- Final root suite: `pnpm test` passed with package scripts, contract schemas, web typecheck, and `116` web tests.
- Final lint: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- Final whitespace: `git diff --check` passed.
- Live default 0DTE smoke: `pnpm collector:ibkr-contracts -- --port 4002 --timeout-seconds 8 --spot 5200 --strike-window-points 50 --max-strikes 3` returned `contracts_count: 0` for Saturday `2026-04-25`.
- Live spot lookup smoke: `pnpm collector:ibkr-contracts -- --port 4002 --client-id 17 --timeout-seconds 15 --expiry 2026-04-27 --strike-window-points 25 --max-strikes 1` reached IBKR and failed cleanly with broker code `354` because SPX top market data is not subscribed.
- Live contract resolution smoke: `pnpm collector:ibkr-contracts -- --port 4002 --client-id 18 --timeout-seconds 15 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1` returned two real IBKR contracts: `SPX-2026-04-27-C-7050` conId `867905902` and `SPX-2026-04-27-P-7050` conId `867906222`.
- Live publish smoke: `pnpm collector:ibkr-contracts -- --port 4002 --client-id 19 --timeout-seconds 15 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1 --publish` returned `accepted_count: 2` and API collector state showed `contracts_count: 2`.
