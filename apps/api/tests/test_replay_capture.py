from __future__ import annotations

from typing import Any

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.replay.capture import capture_live_snapshot_from_state, reset_replay_capture_circuit
from gammascope_api.replay.dependencies import reset_replay_repository_override, set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository


def setup_function() -> None:
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_replay_repository_override()


def test_capture_live_snapshot_from_state_persists_each_ready_symbol_session() -> None:
    repository = _RecordingReplayRepository()
    set_replay_repository_override(repository)
    state = CollectorState()
    for event in [
        _health_event("2026-04-28T13:25:00Z"),
        _underlying_event("moomoo-spy-0dte-live", "SPY", 700.0, "2026-04-28T13:25:01Z"),
        _contract("SPY-2026-04-28-C-701", "call", 701, "moomoo-spy-0dte-live", "SPY"),
        _option_tick("SPY-2026-04-28-C-701", 40, "moomoo-spy-0dte-live"),
        _underlying_event("moomoo-qqq-0dte-live", "QQQ", 664.0, "2026-04-28T13:25:02Z"),
        _contract("QQQ-2026-04-28-C-665", "call", 665, "moomoo-qqq-0dte-live", "QQQ"),
        _option_tick("QQQ-2026-04-28-C-665", 30, "moomoo-qqq-0dte-live"),
        _underlying_event("moomoo-iwm-0dte-live", "IWM", 277.0, "2026-04-28T13:25:03Z"),
        _contract("IWM-2026-04-28-C-277", "call", 277, "moomoo-iwm-0dte-live", "IWM"),
        _option_tick("IWM-2026-04-28-C-277", 50, "moomoo-iwm-0dte-live"),
    ]:
        state.ingest(CollectorEvents.model_validate(event))

    result = capture_live_snapshot_from_state(state)

    assert result["captured"] is True
    assert set(repository.inserted_session_ids) == {
        "moomoo-spy-0dte-live",
        "moomoo-qqq-0dte-live",
        "moomoo-iwm-0dte-live",
    }


class _RecordingReplayRepository(NullReplayRepository):
    def __init__(self) -> None:
        self.inserted_session_ids: list[str] = []

    def insert_snapshot(self, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        self.inserted_session_ids.append(str(snapshot["session_id"]))
        return {
            "snapshot_id": len(self.inserted_session_ids),
            "session_id": snapshot["session_id"],
            "snapshot_time": snapshot["snapshot_time"],
            "row_count": len(snapshot.get("rows", [])),
        }


def _health_event(event_time: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": "local-dev",
        "status": "connected",
        "ibkr_account_mode": "paper",
        "message": "live",
        "event_time": event_time,
        "received_time": event_time,
    }


def _underlying_event(session_id: str, symbol: str, spot: float, event_time: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "symbol": symbol,
        "spot": spot,
        "bid": spot - 0.5,
        "ask": spot + 0.5,
        "last": spot,
        "mark": spot,
        "event_time": event_time,
        "quote_status": "valid",
    }


def _contract(contract_id: str, right: str, strike: float, session_id: str, symbol: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": abs(hash(contract_id)) % 1_000_000,
        "symbol": symbol,
        "expiry": "2026-04-28",
        "right": right,
        "strike": strike,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-28T13:25:00Z",
    }


def _option_tick(contract_id: str, open_interest: int, session_id: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": 12.1,
        "ask": 12.3,
        "last": 12.2,
        "bid_size": 10,
        "ask_size": 10,
        "volume": 100,
        "open_interest": open_interest,
        "ibkr_iv": 0.18,
        "ibkr_delta": 0.5,
        "ibkr_gamma": 0.001,
        "ibkr_vega": 0.8,
        "ibkr_theta": -1.2,
        "event_time": "2026-04-28T13:25:02Z",
        "quote_status": "valid",
    }
