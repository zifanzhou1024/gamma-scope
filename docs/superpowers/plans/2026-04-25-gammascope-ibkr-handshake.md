# GammaScope IBKR Handshake Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow real IBKR API handshake health step that waits for `nextValidId` and emits or publishes one `CollectorHealth` event.

**Architecture:** Add a dedicated collector module with an injectable three-method adapter protocol for tests and a lazy-imported runtime `ibapi` adapter. The health wrapper translates handshake outcomes into contract-valid collector health events, while the CLI mirrors existing collector command behavior.

**Tech Stack:** Python 3.11+, pytest, existing GammaScope collector contracts, optional official IBKR `ibapi`.

---

## Owned Files

- Create: `services/collector/gammascope_collector/ibkr_handshake.py`
- Create: `services/collector/tests/test_ibkr_handshake.py`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-04-25-gammascope-ibkr-handshake.md`

## Tasks

- [x] Add RED tests for injected adapter success, timeout, connection failure, missing `ibapi`, health event mapping, and CLI publish/non-publish behavior.
- [x] Run focused new tests before production code. RED evidence: `ModuleNotFoundError: No module named 'gammascope_collector.ibkr_handshake'`.
- [x] Implement `IbkrApiUnavailable`, `IbkrHandshakeTimeout`, `run_ibkr_api_handshake`, `ibkr_handshake_health_event`, lazy real adapter, and CLI.
- [x] Add `collector:ibkr-handshake` root script.
- [x] Document TCP probe vs API handshake commands and note that timeout maps to `stale`.
- [x] Run final verification commands and record output.

## Evidence

- RED: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` failed with `ModuleNotFoundError: No module named 'gammascope_collector.ibkr_handshake'`.
- GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `11 passed`.
- Review RED: focused handshake tests failed with deterministic missing-`ibapi` seam, bounded thread join, broker error timeout context, and disconnect masking regressions: `5 failed, 11 passed`.
- Review GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `16 passed`.
- Second review RED: focused handshake tests failed because broker error callbacks waited for timeout/mapped to `stale`, and disconnect exceptions skipped thread join: `3 failed, 16 passed`.
- Second review GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `19 passed`.
- Callback-shape RED: focused handshake tests failed because the newer `EWrapper.error(reqId, errorTime, errorCode, errorString, advanced)` shape raised `TypeError` and old-shape metadata lacked an explicit `error_time`: `3 failed, 18 passed`.
- Callback-shape GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `21 passed`.
- Terminal-error RED: focused handshake tests failed because duplicate client id `326`, broken socket `507`, and `connectionClosed` paths waited for timeout or mapped to `stale`: `5 failed, 21 passed`.
- Terminal-error GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `26 passed`.
- Preserve-error RED: focused handshake tests failed because `connectionClosed` overwrote a prior concrete broker error `502`: `1 failed, 26 passed`.
- Preserve-error GREEN focused: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_handshake.py -q` passed with `27 passed`.
- Collector suite: `pnpm test:collector` passed with `65 passed`.
- API suite: `PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q` passed with `28 passed`.
- Lint: `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed.
- Whitespace: `git diff --check` passed.
- Root suite: `pnpm test` passed with package scripts, contract schemas, web typecheck, and `116` web tests.
- Missing `ibapi` smoke: `pnpm collector:ibkr-handshake -- --port 4002 --timeout-seconds 1` printed one `CollectorHealth` JSON with `status:"error"` and a message mentioning missing `ibapi`.

## Notes

- The real adapter imports `ibapi` only inside the runtime factory so importing the module and running injected tests do not require the package.
- The adapter starts the official client network loop on a daemon thread after `connect`, waits only for `nextValidId`, captures best-effort metadata, and disconnects in all paths after adapter creation.
- This slice intentionally excludes SPX contract discovery, market-data subscriptions, option ticks, and option-chain handling.
