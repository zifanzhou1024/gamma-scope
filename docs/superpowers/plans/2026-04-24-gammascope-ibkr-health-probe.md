# GammaScope IBKR Health Probe Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe local IBKR TCP reachability probe that emits or publishes one `CollectorHealth` event.

**Architecture:** Keep configuration parsing separate from probing. The probe wraps `socket.create_connection` behind an injectable connector and reuses the existing collector event factory plus publisher helper.

**Tech Stack:** Python stdlib, pytest, existing GammaScope collector event and publisher modules.

---

## Scope

- Create `services/collector/gammascope_collector/ibkr_config.py` for frozen config defaults, env parsing, and validation.
- Create `services/collector/gammascope_collector/ibkr_health.py` for TCP reachability probing and CLI output/publish mode.
- Add focused pytest coverage in `services/collector/tests/test_ibkr_config.py` and `services/collector/tests/test_ibkr_health.py`.
- Add `pnpm collector:ibkr-health`.
- Document the local probe commands in `README.md`.

## Acceptance Criteria

- [x] Config defaults match the local paper IBKR probe defaults.
- [x] Env overrides trim strings and parse numeric values.
- [x] Invalid host, port, client id, collector id, account mode, and timeout raise `ValueError` with useful names.
- [x] Successful TCP probe emits a contract-valid connected `CollectorHealth` event and closes the context manager.
- [x] Timeout/OSError probe failure emits a contract-valid disconnected `CollectorHealth` event with host, port, and reason.
- [x] CLI accepts pnpm `--`, prints sorted compact event JSON by default, and publishes through an injectable publisher with `--publish`.
- [x] No third-party dependencies or full IBKR market data behavior are added.

## TDD Evidence

- RED: `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_ibkr_config.py services/collector/tests/test_ibkr_health.py -q` failed during collection with `ModuleNotFoundError: No module named 'gammascope_collector.ibkr_config'`.
- GREEN: the same focused command passed with `18 passed in 0.10s`.
- Review-fix RED: the same focused command failed with 6 failures proving `GAMMASCOPE_IBKR_TIMEOUT_SECONDS=nan`, `GAMMASCOPE_IBKR_TIMEOUT_SECONDS=inf`, `GAMMASCOPE_API_BASE_URL="   "`, CLI `--timeout-seconds nan`, CLI `--timeout-seconds inf`, and CLI `--api "   "` were incorrectly accepted.
- Review-fix GREEN: the same focused command passed with `24 passed in 0.07s`.
