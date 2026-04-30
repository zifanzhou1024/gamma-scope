from __future__ import annotations

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.ingestion.live_snapshot_service import LiveSnapshotService


def test_collector_state_revision_increments_on_ingest() -> None:
    state = CollectorState()
    assert state.revision() == 0

    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))

    assert state.revision() == 1
    assert state.summary()["revision"] == 1
    assert state.snapshot()["revision"] == 1
    assert CollectorState.from_snapshot(state.snapshot()).revision() == 1
    assert CollectorState.from_snapshot(state.snapshot()).snapshot()["state_epoch"] == state.snapshot()["state_epoch"]


def test_collector_state_accessors_return_defensive_copies() -> None:
    state = CollectorState()
    for event in _spx_events(spot=5200.0, event_time="2026-04-24T15:30:01Z"):
        state.ingest(CollectorEvents.model_validate(event))

    state.latest_health()["status"] = "mutated"
    state.latest_underlying_tick()["spot"] = 1
    state.contracts()[0]["strike"] = 1
    option_ticks = state.option_ticks()
    option_ticks["SPX-2026-04-24-C-5200"]["bid"] = 1

    assert state.latest_health()["status"] == "connected"
    assert state.latest_underlying_tick()["spot"] == 5200.0
    assert state.contracts()[0]["strike"] == 5200
    assert state.option_ticks()["SPX-2026-04-24-C-5200"]["bid"] == 9.9


def test_live_snapshot_service_caches_dashboard_snapshot_until_state_revision_changes(monkeypatch) -> None:
    state = CollectorState()
    for event in _spx_events(spot=5200.0, event_time="2026-04-24T15:30:01Z"):
        state.ingest(CollectorEvents.model_validate(event))
    calls = 0

    def fake_builder(input_state):
        nonlocal calls
        calls += 1
        return {
            "session_id": "moomoo-spx-0dte-live",
            "spot": input_state.latest_underlying_tick()["spot"],
        }

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        fake_builder,
    )

    service = LiveSnapshotService(lambda: state)

    assert service.dashboard_snapshot()["spot"] == 5200.0
    assert service.dashboard_snapshot()["spot"] == 5200.0
    assert calls == 1

    for event in _spx_events(spot=5210.0, event_time="2026-04-24T15:30:02Z"):
        state.ingest(CollectorEvents.model_validate(event))

    assert service.dashboard_snapshot()["spot"] == 5210.0
    assert calls == 2


def test_live_snapshot_service_refreshes_freshness_without_rebuilding(monkeypatch) -> None:
    state = CollectorState()
    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))
    calls = 0

    def fake_builder(_input_state):
        nonlocal calls
        calls += 1
        return {
            "session_id": "moomoo-spx-0dte-live",
            "snapshot_time": "2024-01-01T00:00:00Z",
            "freshness_ms": 0,
        }

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        fake_builder,
    )

    service = LiveSnapshotService(lambda: state)

    assert service.dashboard_snapshot()["freshness_ms"] > 0
    assert service.dashboard_snapshot()["freshness_ms"] > 0
    assert calls == 1


def test_live_snapshot_service_invalidates_when_state_identity_changes_with_same_revision(monkeypatch) -> None:
    first_state = CollectorState()
    for event in _spx_events(spot=5200.0, event_time="2026-04-24T15:30:01Z"):
        first_state.ingest(CollectorEvents.model_validate(event))
    second_state = CollectorState()
    for event in _spx_events(spot=5210.0, event_time="2026-04-24T15:30:01Z"):
        second_state.ingest(CollectorEvents.model_validate(event))
    states = iter([first_state, second_state])

    def fake_builder(input_state):
        return {
            "session_id": "moomoo-spx-0dte-live",
            "spot": input_state.latest_underlying_tick()["spot"],
        }

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        fake_builder,
    )

    service = LiveSnapshotService(lambda: next(states))

    assert first_state.revision() == second_state.revision()
    assert service.dashboard_snapshot()["spot"] == 5200.0
    assert service.dashboard_snapshot()["spot"] == 5210.0


def test_live_snapshot_service_returns_defensive_copies(monkeypatch) -> None:
    state = CollectorState()
    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        lambda _: {"session_id": "moomoo-spx-0dte-live", "rows": []},
    )

    service = LiveSnapshotService(lambda: state)
    first = service.dashboard_snapshot()
    first["rows"].append({"mutated": True})

    assert service.dashboard_snapshot()["rows"] == []


def test_live_snapshot_service_maps_heatmap_symbols_to_live_sessions(monkeypatch) -> None:
    state = CollectorState()
    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))
    requested = []

    def fake_build_live_snapshot(_state, *, session_id=None):
        requested.append(session_id)
        return {"session_id": session_id}

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_live_snapshot",
        fake_build_live_snapshot,
    )

    service = LiveSnapshotService(lambda: state)

    assert service.symbol_snapshot("SPY") == {"session_id": "moomoo-spy-0dte-live"}
    assert requested == ["moomoo-spy-0dte-live"]


def _spx_events(*, spot: float, event_time: str) -> list[dict[str, object]]:
    return [
        _health_event(event_time),
        _underlying_event("moomoo-spx-0dte-live", "SPX", spot, event_time),
        _contract_event("moomoo-spx-0dte-live", "SPX-2026-04-24-C-5200", "call", event_time),
        _option_event("moomoo-spx-0dte-live", "SPX-2026-04-24-C-5200", event_time),
    ]


def _health_event(event_time: str) -> dict[str, object]:
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


def _underlying_event(session_id: str, symbol: str, spot: float, event_time: str) -> dict[str, object]:
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


def _contract_event(
    session_id: str,
    contract_id: str,
    right: str,
    event_time: str,
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": abs(hash(contract_id)) % 1_000_000,
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "right": right,
        "strike": 5200,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": event_time,
    }


def _option_event(session_id: str, contract_id: str, event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": 9.9,
        "ask": 10.1,
        "last": 10.0,
        "bid_size": 10,
        "ask_size": 11,
        "volume": 380,
        "open_interest": 2200,
        "ibkr_iv": 0.2,
        "ibkr_delta": 0.49,
        "ibkr_gamma": 0.017,
        "ibkr_vega": 0.9,
        "ibkr_theta": -1.0,
        "event_time": event_time,
        "quote_status": "valid",
    }
