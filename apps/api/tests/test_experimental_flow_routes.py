from __future__ import annotations

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.service import reset_experimental_flow_memory
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.ingestion.live_snapshot import reset_live_snapshot_memory
from gammascope_api.ingestion.live_snapshot_service import reset_live_snapshot_service_override
from gammascope_api.main import app
from gammascope_api.routes import experimental_flow as experimental_flow_routes


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    reset_live_snapshot_service_override()
    reset_experimental_flow_memory()
    set_latest_state_cache_override(InMemoryLatestStateCache())


def teardown_function() -> None:
    reset_live_snapshot_service_override()
    reset_latest_state_cache_override()
    reset_experimental_flow_memory()


def test_experimental_flow_latest_route_enforces_generated_response_model() -> None:
    response_models = {
        route.path: route.response_model
        for route in app.routes
        if isinstance(route, APIRoute)
    }

    assert response_models["/api/spx/0dte/experimental-flow/latest"] is ExperimentalFlow


def test_experimental_flow_latest_route_returns_seed_fixture_without_live_snapshot() -> None:
    response = client.get("/api/spx/0dte/experimental-flow/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"
    assert payload["summary"]["estimatedBuyContracts"] == 42


def test_experimental_flow_latest_route_ignores_non_spx_live_snapshot() -> None:
    for event in [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event("2026-04-24T15:30:01Z", session_id="moomoo-spy-0dte-live", symbol="SPY", spot=520.25),
        _contract_event(session_id="moomoo-spy-0dte-live", contract_id="SPY-2026-04-24-C-520", symbol="SPY", strike=520),
        _option_event("2026-04-24T15:30:02Z", 100, session_id="moomoo-spy-0dte-live", contract_id="SPY-2026-04-24-C-520"),
        _health_event("2026-04-24T15:30:05Z"),
        _underlying_event("2026-04-24T15:30:06Z", session_id="moomoo-spy-0dte-live", symbol="SPY", spot=520.5),
        _option_event("2026-04-24T15:30:07Z", 145, session_id="moomoo-spy-0dte-live", contract_id="SPY-2026-04-24-C-520"),
    ]:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/experimental-flow/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"
    assert payload["summary"]["estimatedBuyContracts"] == 42


def test_experimental_flow_latest_route_rejects_non_spx_dashboard_snapshot(monkeypatch) -> None:
    service = _DashboardOnlySnapshotService(
        {
            **_snapshot("2026-04-24T15:30:05Z", 145),
            "session_id": "moomoo-spy-0dte-live",
            "symbol": "SPY",
        }
    )
    monkeypatch.setattr(experimental_flow_routes, "get_live_snapshot_service", lambda: service)

    response = client.get("/api/spx/0dte/experimental-flow/latest")

    assert service.dashboard_calls == 1
    assert response.status_code == 200
    payload = response.json()
    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"


def test_experimental_flow_latest_route_computes_delta_after_two_live_cycles() -> None:
    first_cycle = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event("2026-04-24T15:30:01Z"),
        _contract_event(),
        _option_event("2026-04-24T15:30:02Z", 100),
    ]
    for event in first_cycle:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    first_response = client.get("/api/spx/0dte/experimental-flow/latest")

    assert first_response.status_code == 200
    first_payload = first_response.json()
    ExperimentalFlow.model_validate(first_payload)
    assert first_payload["contractRows"] == []
    assert first_payload["summary"]["confidence"] == "unknown"

    second_cycle = [
        _health_event("2026-04-24T15:30:05Z"),
        _underlying_event("2026-04-24T15:30:06Z"),
        _option_event("2026-04-24T15:30:07Z", 145),
    ]
    for event in second_cycle:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/experimental-flow/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalFlow.model_validate(payload)
    assert payload["meta"]["sourceSessionId"] == "moomoo-spx-0dte-live"
    assert payload["meta"]["previousSnapshotTime"] == first_payload["meta"]["currentSnapshotTime"]
    assert payload["summary"]["estimatedBuyContracts"] == 45
    assert payload["contractRows"][0]["contractId"] == "SPX-2026-04-24-C-5200"
    assert payload["contractRows"][0]["volumeDelta"] == 45
    assert payload["contractRows"][0]["aggressor"] == "buy"


def _health_event(event_time: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": "local-dev",
        "status": "connected",
        "ibkr_account_mode": "paper",
        "message": "experimental flow test",
        "event_time": event_time,
        "received_time": event_time,
    }


def _underlying_event(
    event_time: str,
    *,
    session_id: str = "moomoo-spx-0dte-live",
    symbol: str = "SPX",
    spot: float = 5200.25,
) -> dict:
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


class _DashboardOnlySnapshotService:
    def __init__(self, dashboard_snapshot: dict) -> None:
        self._dashboard_snapshot = dashboard_snapshot
        self.dashboard_calls = 0

    def dashboard_snapshot(self) -> dict:
        self.dashboard_calls += 1
        return self._dashboard_snapshot

    def symbol_snapshot(self, _symbol: str) -> dict | None:
        return None


def _snapshot(snapshot_time: str, volume: int) -> dict:
    return {
        "schema_version": "1.0.0",
        "session_id": "moomoo-spx-0dte-live",
        "mode": "live",
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "snapshot_time": snapshot_time,
        "spot": 5200.25,
        "source_status": "connected",
        "freshness_ms": 0,
        "rows": [
            {
                "contract_id": "SPX-2026-04-24-C-5200",
                "right": "call",
                "strike": 5200,
                "bid": 9.8,
                "ask": 10.2,
                "mid": 10.0,
                "last": 10.25,
                "bid_size": 12,
                "ask_size": 8,
                "volume": volume,
                "open_interest": 500,
                "custom_gamma": 0.017,
                "custom_vanna": 0.002,
                "ibkr_delta": 0.51,
                "ibkr_vega": 2.0,
                "ibkr_theta": -1.25,
            }
        ],
    }


def _contract_event(
    *,
    session_id: str = "moomoo-spx-0dte-live",
    contract_id: str = "SPX-2026-04-24-C-5200",
    symbol: str = "SPX",
    strike: float = 5200,
) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": 520024,
        "symbol": symbol,
        "expiry": "2026-04-24",
        "right": "call",
        "strike": strike,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-24T15:30:01Z",
    }


def _option_event(
    event_time: str,
    volume: int,
    *,
    session_id: str = "moomoo-spx-0dte-live",
    contract_id: str = "SPX-2026-04-24-C-5200",
) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": 9.8,
        "ask": 10.2,
        "last": 10.25,
        "bid_size": 12,
        "ask_size": 8,
        "volume": volume,
        "open_interest": 500,
        "ibkr_iv": 0.2,
        "ibkr_delta": 0.51,
        "ibkr_gamma": 0.017,
        "ibkr_vega": 2.0,
        "ibkr_theta": -1.25,
        "event_time": event_time,
        "quote_status": "valid",
    }
