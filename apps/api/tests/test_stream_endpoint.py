import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.main import app
from gammascope_api.replay.capture import reset_replay_capture_circuit
from gammascope_api.replay.dependencies import set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository
from gammascope_api.routes import stream as stream_routes
from gammascope_api.routes.replay import seed_replay_snapshots


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(NullReplayRepository())
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_latest_state_cache_override()


def test_websocket_path_streams_valid_snapshot_on_connect() -> None:
    with client.websocket_connect("/ws/spx/0dte") as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert payload["symbol"] == "SPX"
    assert payload["rows"] != []


def test_live_websocket_interval_matches_moomoo_snapshot_interval() -> None:
    assert stream_routes.STREAM_INTERVAL_SECONDS == 2.0


def test_websocket_first_message_prefers_live_collector_snapshot() -> None:
    session_id = "live-ws-test-session"
    for event in _live_events(session_id):
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    with client.websocket_connect("/ws/spx/0dte") as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "live"
    assert payload["session_id"] == session_id
    assert payload["spot"] == 5200.25


def test_websocket_first_message_prefers_cached_collector_snapshot() -> None:
    session_id = "cached-ws-test-session"
    for event in _live_events(session_id):
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200
    collector_state.clear()

    with client.websocket_connect("/ws/spx/0dte") as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "live"
    assert payload["session_id"] == session_id
    assert payload["spot"] == 5200.25


def test_websocket_first_message_falls_back_to_seeded_replay_without_live_snapshot() -> None:
    assert client.post(
        "/api/spx/0dte/collector/events",
        json={
            "schema_version": "1.0.0",
            "source": "ibkr",
            "collector_id": "local-dev",
            "status": "connected",
            "ibkr_account_mode": "paper",
            "message": "Only health is not enough for a live snapshot",
            "event_time": "2026-04-24T15:30:00Z",
            "received_time": "2026-04-24T15:30:00Z",
        },
    ).status_code == 200

    with client.websocket_connect("/ws/spx/0dte") as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "replay"
    assert payload["session_id"] == "seed-spx-2026-04-23"


def test_replay_websocket_streams_seeded_snapshots_in_chronological_order() -> None:
    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "seed-spx-2026-04-23", "interval_ms": "50"},
    ) as websocket:
        payloads = [websocket.receive_json() for _ in range(4)]

    for payload in payloads:
        AnalyticsSnapshot.model_validate(payload)
        assert payload["mode"] == "replay"
        assert payload["session_id"] == "seed-spx-2026-04-23"

    assert [payload["snapshot_time"] for payload in payloads] == [
        "2026-04-23T15:30:00Z",
        "2026-04-23T15:40:00Z",
        "2026-04-23T15:50:00Z",
        "2026-04-23T16:00:00Z",
    ]


def test_replay_websocket_fetches_snapshots_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    is_event_loop_thread_by_call: list[bool] = []

    def fake_replay_stream_snapshots(session_id: str, at: str | None = None) -> list[dict]:
        try:
            asyncio.get_running_loop()
            is_event_loop_thread_by_call.append(True)
        except RuntimeError:
            is_event_loop_thread_by_call.append(False)
        return [seed_replay_snapshots()[0]]

    monkeypatch.setattr(stream_routes, "replay_stream_snapshots", fake_replay_stream_snapshots)

    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "seed-spx-2026-04-23", "interval_ms": "50"},
    ) as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert is_event_loop_thread_by_call == [False]


def test_replay_websocket_starts_at_first_seeded_snapshot_at_or_after_requested_time() -> None:
    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={
            "session_id": "seed-spx-2026-04-23",
            "at": "2026-04-23T15:35:00Z",
            "interval_ms": "50",
        },
    ) as websocket:
        payloads = [websocket.receive_json() for _ in range(3)]

    assert [payload["snapshot_time"] for payload in payloads] == [
        "2026-04-23T15:40:00Z",
        "2026-04-23T15:50:00Z",
        "2026-04-23T16:00:00Z",
    ]


def test_replay_websocket_closes_after_final_replay_snapshot() -> None:
    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={
            "session_id": "seed-spx-2026-04-23",
            "at": "2026-04-23T16:00:00Z",
            "interval_ms": "50",
        },
    ) as websocket:
        payload = websocket.receive_json()
        with pytest.raises(WebSocketDisconnect) as disconnect:
            websocket.receive_json()

    assert payload["snapshot_time"] == "2026-04-23T16:00:00Z"
    assert disconnect.value.code == 1000


def test_replay_websocket_sends_empty_replay_snapshot_for_unknown_session() -> None:
    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "unknown-session", "interval_ms": "50"},
    ) as websocket:
        payload = websocket.receive_json()

    AnalyticsSnapshot.model_validate(payload)
    assert payload["session_id"] == "seed-spx-2026-04-23"
    assert payload["coverage_status"] == "empty"
    assert payload["rows"] == []


def _live_events(session_id: str) -> list[dict[str, object]]:
    return [
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "collector_id": "local-dev",
            "status": "connected",
            "ibkr_account_mode": "paper",
            "message": "Mock live cycle",
            "event_time": "2026-04-24T15:30:00Z",
            "received_time": "2026-04-24T15:30:00Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": session_id,
            "symbol": "SPX",
            "spot": 5200.25,
            "bid": 5199.75,
            "ask": 5200.75,
            "last": 5200.25,
            "mark": 5200.25,
            "event_time": "2026-04-24T15:30:00Z",
            "quote_status": "valid",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": session_id,
            "contract_id": "SPX-2026-04-24-C-5200",
            "ibkr_con_id": 900000,
            "symbol": "SPX",
            "expiry": "2026-04-24",
            "right": "call",
            "strike": 5200,
            "multiplier": 100,
            "exchange": "CBOE",
            "currency": "USD",
            "event_time": "2026-04-24T15:30:00Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": session_id,
            "contract_id": "SPX-2026-04-24-C-5200",
            "bid": 9.9,
            "ask": 10.1,
            "last": 10.0,
            "bid_size": 10,
            "ask_size": 12,
            "volume": 400,
            "open_interest": 2400,
            "ibkr_iv": 0.2,
            "ibkr_delta": 0.51,
            "ibkr_gamma": 0.017,
            "ibkr_vega": 0.9,
            "ibkr_theta": -1.0,
            "event_time": "2026-04-24T15:30:00Z",
            "quote_status": "valid",
        },
    ]
