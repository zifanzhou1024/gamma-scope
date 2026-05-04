import pytest
from fastapi.testclient import TestClient

from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.ingestion.live_snapshot_service import reset_live_snapshot_service_override
from gammascope_api.main import app
from gammascope_api.replay.capture import reset_replay_capture_circuit
from gammascope_api.replay.dependencies import reset_replay_repository_override, set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository
from gammascope_api.saved_views.dependencies import (
    reset_saved_view_repository_override,
    set_saved_view_repository_override,
)
from gammascope_api.saved_views.repository import InMemorySavedViewRepository


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_service_override()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(NullReplayRepository())
    set_saved_view_repository_override(InMemorySavedViewRepository())
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_live_snapshot_service_override()
    reset_latest_state_cache_override()
    reset_replay_repository_override()
    reset_saved_view_repository_override()


def test_private_mode_disabled_preserves_live_collector_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE", raising=False)
    monkeypatch.delenv("GAMMASCOPE_ADMIN_TOKEN", raising=False)

    for event in _live_events("open-local-live"):
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    state_response = client.get("/api/spx/0dte/collector/state")
    latest_response = client.get("/api/spx/0dte/snapshot/latest")

    assert state_response.status_code == 200
    assert state_response.json()["contracts_count"] == 1
    assert latest_response.status_code == 200
    assert latest_response.json()["mode"] == "live"
    assert latest_response.json()["session_id"] == "open-local-live"


def test_private_mode_blocks_unauthenticated_collector_ingest_and_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    ingest_response = client.post("/api/spx/0dte/collector/events", json=_health_event("2026-04-24T15:30:00Z"))
    state_response = client.get("/api/spx/0dte/collector/state")
    authorized_state_response = client.get(
        "/api/spx/0dte/collector/state",
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert ingest_response.status_code == 403
    assert state_response.status_code == 403
    assert authorized_state_response.status_code == 200
    assert authorized_state_response.json()["health_events_count"] == 0


def test_private_mode_authenticates_collector_ingest_before_payload_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    response = client.post(
        "/api/spx/0dte/collector/events",
        json={"schema_version": "1.0.0", "source": "ibkr"},
    )

    assert response.status_code == 403
    assert collector_state.summary()["last_event_time"] is None


def test_collector_ingest_still_rejects_malformed_json_when_private_mode_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE", raising=False)

    response = client.post(
        "/api/spx/0dte/collector/events",
        content="{",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422


def test_collector_ingest_validation_errors_keep_body_locations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", raising=False)
    monkeypatch.delenv("GAMMASCOPE_PRIVATE_MODE", raising=False)

    response = client.post(
        "/api/spx/0dte/collector/events",
        json={"schema_version": "1.0.0", "source": "ibkr"},
    )

    assert response.status_code == 422
    assert all(error["loc"][0] == "body" for error in response.json()["detail"])
    assert all("url" not in error for error in response.json()["detail"])


def test_private_mode_latest_snapshot_is_public_without_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    for event in _live_events("private-live-session"):
        assert client.post(
            "/api/spx/0dte/collector/events",
            json=event,
            headers={"X-GammaScope-Admin-Token": "local-admin-token"},
        ).status_code == 200

    public_response = client.get("/api/spx/0dte/snapshot/latest")
    admin_response = client.get(
        "/api/spx/0dte/snapshot/latest",
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert public_response.status_code == 200
    assert public_response.json()["mode"] == "live"
    assert public_response.json()["session_id"] == "private-live-session"
    assert admin_response.status_code == 200
    assert admin_response.json()["mode"] == "live"
    assert admin_response.json()["session_id"] == "private-live-session"


def test_private_mode_status_and_scenario_are_public_without_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    for event in _live_events("private-scenario-session"):
        assert client.post(
            "/api/spx/0dte/collector/events",
            json=event,
            headers={"X-GammaScope-Admin-Token": "local-admin-token"},
        ).status_code == 200

    public_status_response = client.get("/api/spx/0dte/status")
    public_scenario_response = client.post(
        "/api/spx/0dte/scenario",
        json={
            "session_id": "private-scenario-session",
            "snapshot_time": "2026-04-24T15:30:00Z",
            "spot_shift_points": 10,
            "vol_shift_points": 0,
            "time_shift_minutes": 0,
        },
    )
    admin_scenario_response = client.post(
        "/api/spx/0dte/scenario",
        json={
            "session_id": "private-scenario-session",
            "snapshot_time": "2026-04-24T15:30:00Z",
            "spot_shift_points": 10,
            "vol_shift_points": 0,
            "time_shift_minutes": 0,
        },
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    )

    assert public_status_response.status_code == 200
    assert public_status_response.json()["message"] == "Mock live cycle"
    assert public_scenario_response.status_code == 200
    assert public_scenario_response.json()["session_id"] == "private-scenario-session"
    assert admin_scenario_response.status_code == 200
    assert admin_scenario_response.json()["session_id"] == "private-scenario-session"


def test_private_mode_keeps_replay_rest_open(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    sessions_response = client.get("/api/spx/0dte/replay/sessions")
    snapshot_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23"},
    )

    assert sessions_response.status_code == 200
    assert any(
        session["session_id"] == "seed-spx-2026-04-23"
        for session in sessions_response.json()
    )
    assert snapshot_response.status_code == 200
    assert snapshot_response.json()["mode"] == "replay"


def test_private_mode_live_websocket_is_public_without_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    for event in _live_events("private-websocket-session"):
        assert client.post(
            "/api/spx/0dte/collector/events",
            json=event,
            headers={"X-GammaScope-Admin-Token": "local-admin-token"},
        ).status_code == 200

    with client.websocket_connect("/ws/spx/0dte") as websocket:
        payload = websocket.receive_json()

    assert payload["mode"] == "live"
    assert payload["session_id"] == "private-websocket-session"


def test_private_mode_keeps_replay_websocket_public(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")

    with client.websocket_connect(
        "/ws/spx/0dte/replay",
        params={"session_id": "seed-spx-2026-04-23", "interval_ms": "50"},
    ) as websocket:
        payload = websocket.receive_json()

    assert payload["mode"] == "replay"
    assert payload["session_id"] == "seed-spx-2026-04-23"


def test_private_mode_saved_views_filter_public_and_require_admin_token_for_admin_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")
    public_view = _saved_view("public-view", "public_demo")
    admin_view = _saved_view("admin-view", "admin")

    assert client.post("/api/views", json=public_view).status_code == 200
    assert client.post("/api/views", json=admin_view).status_code == 403
    assert client.post(
        "/api/views",
        json=admin_view,
        headers={"X-GammaScope-Admin-Token": "local-admin-token"},
    ).status_code == 200

    public_list = client.get("/api/views")
    admin_list = client.get("/api/views", headers={"X-GammaScope-Admin-Token": "local-admin-token"})

    assert public_list.status_code == 200
    assert {view["view_id"] for view in public_list.json()} == {"public-view"}
    assert admin_list.status_code == 200
    assert {view["view_id"] for view in admin_list.json()} == {"public-view", "admin-view"}


def _live_events(session_id: str) -> list[dict[str, object]]:
    return [
        _health_event("2026-04-24T15:30:00Z"),
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
            "contract_id": f"{session_id}-C-5200",
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
            "contract_id": f"{session_id}-C-5200",
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


def _health_event(event_time: str) -> dict[str, object]:
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


def _saved_view(view_id: str, owner_scope: str) -> dict[str, object]:
    return {
        "view_id": view_id,
        "owner_scope": owner_scope,
        "name": f"{owner_scope} view",
        "mode": "replay",
        "strike_window": {"levels_each_side": 20},
        "visible_charts": ["iv_smile"],
        "created_at": "2026-04-23T16:00:00Z",
    }
