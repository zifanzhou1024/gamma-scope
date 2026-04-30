from __future__ import annotations

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.ingestion.live_snapshot import reset_live_snapshot_memory
from gammascope_api.ingestion.live_snapshot_service import reset_live_snapshot_service_override
from gammascope_api.main import app
from gammascope_api.routes import experimental as experimental_routes


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    reset_live_snapshot_service_override()
    set_latest_state_cache_override(InMemoryLatestStateCache())


def teardown_function() -> None:
    reset_live_snapshot_service_override()
    reset_latest_state_cache_override()


def test_experimental_routes_enforce_generated_response_model() -> None:
    response_models = {
        route.path: route.response_model
        for route in app.routes
        if isinstance(route, APIRoute)
    }

    assert response_models["/api/spx/0dte/experimental/latest"] is ExperimentalAnalytics
    assert response_models["/api/spx/0dte/experimental/replay/snapshot"] is ExperimentalAnalytics


def test_latest_experimental_route_falls_back_to_seed_payload() -> None:
    response = client.get("/api/spx/0dte/experimental/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"
    assert payload["forwardSummary"]["status"] == "ok"


def test_latest_experimental_route_prefers_moomoo_spx_session_when_other_symbols_are_newer() -> None:
    for event in [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event("moomoo-spx-0dte-live", "SPX", 5200.25, "2026-04-24T15:30:01Z"),
        _contract_event("moomoo-spx-0dte-live", "SPX-2026-04-24-C-5200", "SPX", "call", 5200),
        _contract_event("moomoo-spx-0dte-live", "SPX-2026-04-24-P-5200", "SPX", "put", 5200),
        _option_event("moomoo-spx-0dte-live", "SPX-2026-04-24-C-5200", 9.9, 10.1),
        _option_event("moomoo-spx-0dte-live", "SPX-2026-04-24-P-5200", 9.7, 9.9),
        _underlying_event("moomoo-ndx-0dte-live", "NDX", 18300.0, "2026-04-24T15:30:03Z"),
        _contract_event("moomoo-ndx-0dte-live", "NDX-2026-04-24-C-18300", "NDX", "call", 18300),
        _option_event("moomoo-ndx-0dte-live", "NDX-2026-04-24-C-18300", 30.0, 31.0),
    ]:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/experimental/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["sourceSessionId"] == "moomoo-spx-0dte-live"
    assert payload["meta"]["symbol"] == "SPX"
    assert payload["sourceSnapshot"]["spot"] == 5200.25


def test_replay_experimental_route_delegates_to_replay_snapshot_helper(monkeypatch) -> None:
    calls = []

    def fake_replay_snapshot(session_id: str, at: str | None = None, source_snapshot_id: str | None = None) -> dict:
        calls.append({"session_id": session_id, "at": at, "source_snapshot_id": source_snapshot_id})
        return load_json_fixture("analytics-snapshot.seed.json")

    monkeypatch.setattr(experimental_routes.replay_routes, "get_replay_snapshot", fake_replay_snapshot)

    response = client.get(
        "/api/spx/0dte/experimental/replay/snapshot",
        params={
            "session_id": "session-1",
            "at": "2026-04-23T15:50:00Z",
            "source_snapshot_id": "source-1",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert calls == [
        {
            "session_id": "session-1",
            "at": "2026-04-23T15:50:00Z",
            "source_snapshot_id": "source-1",
        }
    ]
    assert payload["meta"]["mode"] == "replay"


def test_replay_experimental_route_degrades_malformed_replay_snapshot(monkeypatch) -> None:
    def malformed_replay_snapshot(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {
            "session_id": "malformed",
            "symbol": "SPX",
            "snapshot_time": "bad-time",
            "expiry": "bad-expiry",
            "spot": "bad-spot",
            "rows": [None, {"right": "call", "strike": "bad"}],
        }

    monkeypatch.setattr(experimental_routes.replay_routes, "get_replay_snapshot", malformed_replay_snapshot)

    response = client.get("/api/spx/0dte/experimental/replay/snapshot", params={"session_id": "malformed"})

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["mode"] == "replay"
    assert payload["sourceSnapshot"]["spot"] == 0.0
    assert payload["forwardSummary"]["status"] == "insufficient_data"


def test_replay_experimental_route_serializes_extreme_numeric_snapshot(monkeypatch) -> None:
    def extreme_replay_snapshot(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {
            "session_id": "extreme-session",
            "symbol": "SPX",
            "snapshot_time": "2026-04-23T15:50:00Z",
            "expiry": "2026-04-23",
            "spot": 5000,
            "rows": [
                {"right": "call", "strike": 1e308, "bid": 1e308, "ask": 1e308, "mid": 1e308},
                {"right": "put", "strike": 1e308, "bid": 0.5, "ask": 0.6, "mid": 0.55},
            ],
        }

    monkeypatch.setattr(experimental_routes.replay_routes, "get_replay_snapshot", extreme_replay_snapshot)

    response = client.get("/api/spx/0dte/experimental/replay/snapshot", params={"session_id": "extreme-session"})

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["forwardSummary"]["parityForward"] is None
    assert payload["forwardSummary"]["expectedRange"] is None


def _health_event(event_time: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": "local-dev",
        "status": "connected",
        "ibkr_account_mode": "paper",
        "message": "Mock live cycle",
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


def _contract_event(session_id: str, contract_id: str, symbol: str, right: str, strike: float) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": abs(hash(contract_id)) % 1_000_000,
        "symbol": symbol,
        "expiry": "2026-04-24",
        "right": right,
        "strike": strike,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-24T15:30:01Z",
    }


def _option_event(session_id: str, contract_id: str, bid: float, ask: float) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": bid,
        "ask": ask,
        "last": (bid + ask) / 2,
        "bid_size": 10,
        "ask_size": 12,
        "volume": 400,
        "open_interest": 2400,
        "ibkr_iv": 0.2,
        "ibkr_delta": 0.51,
        "ibkr_gamma": 0.017,
        "ibkr_vega": 0.9,
        "ibkr_theta": -1.0,
        "event_time": "2026-04-24T15:30:02Z",
        "quote_status": "valid",
    }
