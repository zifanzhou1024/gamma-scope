# GammaScope IBKR Delayed Snapshot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot delayed IBKR market-data snapshot collector that publishes enough events for the web app to render real IBKR-delayed option rows.

**Architecture:** Reuse the SPX contract discovery slice for contract IDs, then request delayed market data with `reqMarketDataType(3)` and snapshot `reqMktData` calls for SPX and discovered options. Map delayed ticks into existing `UnderlyingTick` and `OptionTick` collector events, then publish through the existing ingestion endpoint.

**Tech Stack:** Python 3.11+, pytest, official IBKR `ibapi`, existing GammaScope collector contracts.

---

## Owned Files

- Create: `services/collector/gammascope_collector/ibkr_delayed_snapshot.py`
- Create: `services/collector/tests/test_ibkr_delayed_snapshot.py`
- Modify: `package.json`
- Modify: `README.md`
- Create: this plan/evidence file

## Task: One-Shot Delayed Snapshot

- [x] Write RED tests for delayed snapshot collection, CLI publish mode, delayed market-data API calls, delayed underlying ticks, delayed option ticks/Greeks, and request-scoped market-data errors.
- [x] Run focused tests and capture RED failure before production code exists.
- [x] Implement delayed snapshot config/result, delayed quote adapter protocol, lazy real `ibapi` adapter, event assembly, and CLI.
- [x] Add `collector:ibkr-delayed-snapshot` root script.
- [x] Document delayed snapshot usage and market-data caveats.
- [x] Run final verification, live delayed smoke, and commit.

## Evidence

- RED: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_delayed_snapshot.py -q` failed with `ModuleNotFoundError: No module named 'gammascope_collector.ibkr_delayed_snapshot'`.
- GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_delayed_snapshot.py -q` passed with `6 passed`.
- GREEN collector suite: `pnpm test:collector` passed with `91 passed`.
- Initial lint: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` found two unused imports in the new test file.
- Lint after cleanup: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- Live RED smoke: `pnpm collector:ibkr-delayed-snapshot -- --port 4002 --client-id 31 --timeout-seconds 15 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1` failed with IBKR code `10167`, a delayed-data notice that was incorrectly treated as fatal.
- Notice-code RED: focused regression for code `10167` failed with `IbkrBrokerError`; after adding code `10090`, the parameterized notice test failed for `10090`.
- Notice-code GREEN: delayed notice regression passed for codes `10167` and `10090`.
- None-Greeks RED: focused option-computation regression failed with `TypeError: '>' not supported between instances of 'NoneType' and 'int'`.
- None-Greeks GREEN: focused option-computation regression passed after safely handling `None` and invalid numeric values.
- Live delayed snapshot smoke: `pnpm collector:ibkr-delayed-snapshot -- --port 4002 --client-id 34 --timeout-seconds 20 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1` returned `contracts_count: 2` and `option_ticks_count: 2` with delayed last prices/volume.
- Live publish smoke: `pnpm collector:ibkr-delayed-snapshot -- --port 4002 --client-id 35 --timeout-seconds 20 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1 --publish` returned `accepted_count: 6` and event types `CollectorHealth`, `UnderlyingTick`, two `ContractDiscovered`, and two `OptionTick`.
- API state after publish: `/api/spx/0dte/collector/state` showed `health_events_count: 1`, `contracts_count: 2`, `underlying_ticks_count: 1`, and `option_ticks_count: 2`.
- API snapshot after publish: `/api/spx/0dte/snapshot/latest` returned `mode: live`, `expiry: 2026-04-27`, `source_status: degraded`, and two rows. Rows were `missing_quote` because IBKR supplied delayed last/volume but no bid/ask in that smoke.
- Final focused verification: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_delayed_snapshot.py -q` passed with `8 passed`.
- Final collector verification: `pnpm test:collector` passed with `93 passed`.
- Final API verification: `PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q` passed with `28 passed`.
- Final lint verification: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- Final workspace verification: `pnpm test` passed with `16` web test files and `116` web tests passing after scripts, contracts, and web typecheck completed.
- Fresh live publish verification: `pnpm collector:ibkr-delayed-snapshot -- --port 4002 --client-id 36 --timeout-seconds 20 --expiry 2026-04-27 --spot 7050 --strike-window-points 10 --max-strikes 1 --publish` returned `accepted_count: 6`, `contracts_count: 2`, and `option_ticks_count: 2`.
- Fresh frontend API verification: `http://localhost:3000/api/spx/0dte/snapshot/latest` returned `mode: live`, `expiry: 2026-04-27`, `source_status: degraded`, and two rows for the delayed call/put contracts.
