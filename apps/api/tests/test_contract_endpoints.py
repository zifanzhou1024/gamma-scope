from fastapi.testclient import TestClient

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.main import app


client = TestClient(app)


def test_latest_snapshot_returns_seed_contract() -> None:
    response = client.get("/api/spx/0dte/snapshot/latest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.0.0"
    assert payload["mode"] == "replay"
    assert payload["symbol"] == "SPX"
    assert len(payload["rows"]) == 34
    assert payload["rows"][0]["open_interest"] is not None


def test_status_returns_seed_health() -> None:
    response = client.get("/api/spx/0dte/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "ibkr"
    assert payload["status"] == "connected"


def test_replay_sessions_exposes_seed_session() -> None:
    response = client.get("/api/spx/0dte/replay/sessions")

    assert response.status_code == 200
    assert response.json()[0]["session_id"] == "seed-spx-2026-04-23"


def test_replay_snapshot_returns_seed_when_session_matches() -> None:
    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T16:00:00Z"},
    )

    assert response.status_code == 200
    assert response.json()["session_id"] == "seed-spx-2026-04-23"


def test_scenario_returns_scenario_snapshot() -> None:
    base_snapshot = load_json_fixture("analytics-snapshot.seed.json")
    response = client.post(
        "/api/spx/0dte/scenario",
        json={
            "session_id": "seed-spx-2026-04-23",
            "snapshot_time": "2026-04-23T16:00:00Z",
            "spot_shift_points": 25,
            "vol_shift_points": 1.5,
            "time_shift_minutes": -30,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "scenario"
    assert payload["spot"] == base_snapshot["spot"] + 25
    assert payload["forward"] != base_snapshot["forward"]
    assert payload["scenario_params"] == {
        "spot_shift_points": 25,
        "vol_shift_points": 1.5,
        "time_shift_minutes": -30,
    }

    base_call = base_snapshot["rows"][0]
    scenario_call = payload["rows"][0]
    assert scenario_call["custom_iv"] == base_call["custom_iv"] + 0.015
    assert scenario_call["custom_gamma"] != base_call["custom_gamma"]
    assert scenario_call["custom_vanna"] != base_call["custom_vanna"]
    assert scenario_call["iv_diff"] == scenario_call["custom_iv"] - scenario_call["ibkr_iv"]
    assert scenario_call["gamma_diff"] == scenario_call["custom_gamma"] - scenario_call["ibkr_gamma"]
    assert scenario_call["calc_status"] == "ok"


def test_saved_views_round_trip_in_memory() -> None:
    view = {
        "view_id": "seed-default-view",
        "owner_scope": "public_demo",
        "name": "Default replay view",
        "mode": "replay",
        "strike_window": {"levels_each_side": 20},
        "visible_charts": ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
        "created_at": "2026-04-23T16:00:00Z",
    }

    create_response = client.post("/api/views", json=view)
    list_response = client.get("/api/views")

    assert create_response.status_code == 200
    assert list_response.status_code == 200
    assert view in list_response.json()
