from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.main import app


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()


def test_collector_ingest_accepts_health_event() -> None:
    event = {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": "local-dev",
        "status": "degraded",
        "ibkr_account_mode": "paper",
        "message": "Mock collector is warming up",
        "event_time": "2026-04-23T15:30:00Z",
        "received_time": "2026-04-23T15:30:01Z",
    }

    ingest_response = client.post("/api/spx/0dte/collector/events", json=event)
    state_response = client.get("/api/spx/0dte/collector/state")
    status_response = client.get("/api/spx/0dte/status")

    assert ingest_response.status_code == 200
    assert ingest_response.json()["accepted"] is True
    assert ingest_response.json()["event_type"] == "CollectorHealth"
    assert state_response.status_code == 200
    assert state_response.json()["health_events_count"] == 1
    assert state_response.json()["contracts_count"] == 0
    assert state_response.json()["option_ticks_count"] == 0
    assert status_response.json()["status"] == "degraded"
    assert status_response.json()["message"] == "Mock collector is warming up"


def test_collector_ingest_tracks_contract_underlying_and_option_events() -> None:
    contract_event = {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": "live-spx-local-mock",
        "contract_id": "SPX-2026-04-23-C-5200",
        "ibkr_con_id": 900000,
        "symbol": "SPX",
        "expiry": "2026-04-23",
        "right": "call",
        "strike": 5200,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-23T15:30:00Z",
    }
    underlying_event = {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": "live-spx-local-mock",
        "symbol": "SPX",
        "spot": 5200.25,
        "bid": 5199.75,
        "ask": 5200.75,
        "last": 5200.25,
        "mark": 5200.25,
        "event_time": "2026-04-23T15:30:01Z",
        "quote_status": "valid",
    }
    option_event = {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": "live-spx-local-mock",
        "contract_id": "SPX-2026-04-23-C-5200",
        "bid": 12.1,
        "ask": 12.25,
        "last": 12.18,
        "bid_size": 11,
        "ask_size": 14,
        "volume": 500,
        "open_interest": 2500,
        "ibkr_iv": 0.18,
        "ibkr_delta": 0.51,
        "ibkr_gamma": 0.012,
        "ibkr_vega": 0.8,
        "ibkr_theta": -1.2,
        "event_time": "2026-04-23T15:30:02Z",
        "quote_status": "valid",
    }

    assert client.post("/api/spx/0dte/collector/events", json=contract_event).json()["event_type"] == "ContractDiscovered"
    assert client.post("/api/spx/0dte/collector/events", json=underlying_event).json()["event_type"] == "UnderlyingTick"
    assert client.post("/api/spx/0dte/collector/events", json=option_event).json()["event_type"] == "OptionTick"

    state = client.get("/api/spx/0dte/collector/state").json()
    assert state["contracts_count"] == 1
    assert state["underlying_ticks_count"] == 1
    assert state["option_ticks_count"] == 1
    assert state["last_event_time"] == "2026-04-23T15:30:02Z"


def test_collector_ingest_rejects_invalid_payload() -> None:
    response = client.post(
        "/api/spx/0dte/collector/events",
        json={
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-spx-local-mock",
        },
    )

    assert response.status_code == 422


def test_latest_snapshot_prefers_ingested_live_snapshot() -> None:
    events = [
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
            "session_id": "live-spx-local-mock",
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
            "session_id": "live-spx-local-mock",
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
            "session_id": "live-spx-local-mock",
            "contract_id": "SPX-2026-04-24-P-5200",
            "ibkr_con_id": 900001,
            "symbol": "SPX",
            "expiry": "2026-04-24",
            "right": "put",
            "strike": 5200,
            "multiplier": 100,
            "exchange": "CBOE",
            "currency": "USD",
            "event_time": "2026-04-24T15:30:00Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-spx-local-mock",
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
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-spx-local-mock",
            "contract_id": "SPX-2026-04-24-P-5200",
            "bid": 9.7,
            "ask": 9.9,
            "last": 9.8,
            "bid_size": 9,
            "ask_size": 11,
            "volume": 380,
            "open_interest": 2200,
            "ibkr_iv": 0.2,
            "ibkr_delta": -0.49,
            "ibkr_gamma": 0.017,
            "ibkr_vega": 0.9,
            "ibkr_theta": -1.0,
            "event_time": "2026-04-24T15:30:00Z",
            "quote_status": "valid",
        },
    ]

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/snapshot/latest")

    assert response.status_code == 200
    payload = response.json()
    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "live"
    assert payload["session_id"] == "live-spx-local-mock"
    assert payload["spot"] == 5200.25
    assert len(payload["rows"]) == 2
    assert {row["right"] for row in payload["rows"]} == {"call", "put"}
    assert all(row["open_interest"] is not None for row in payload["rows"])
    assert all(row["custom_iv"] is not None for row in payload["rows"])
    assert all(row["custom_gamma"] is not None for row in payload["rows"])
    assert all(row["custom_vanna"] is not None for row in payload["rows"])


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
    session = response.json()[0]
    assert session["session_id"] == "seed-spx-2026-04-23"
    assert session["snapshot_count"] > 1
    assert session["start_time"] != session["end_time"]


def test_replay_snapshot_selects_nearest_seeded_time() -> None:
    early_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T15:30:00Z"},
    )
    late_response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T16:00:00Z"},
    )

    assert early_response.status_code == 200
    assert late_response.status_code == 200
    early_payload = early_response.json()
    late_payload = late_response.json()
    AnalyticsSnapshot.model_validate(early_payload)
    AnalyticsSnapshot.model_validate(late_payload)
    assert early_payload["session_id"] == "seed-spx-2026-04-23"
    assert early_payload["snapshot_time"] != late_payload["snapshot_time"]
    assert early_payload["spot"] != late_payload["spot"]
    assert early_payload["rows"][0]["custom_iv"] != late_payload["rows"][0]["custom_iv"]


def test_replay_snapshot_accepts_naive_iso_time_as_utc() -> None:
    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T15:35:00"},
    )

    assert response.status_code == 200
    payload = response.json()
    AnalyticsSnapshot.model_validate(payload)
    assert payload["session_id"] == "seed-spx-2026-04-23"
    assert payload["snapshot_time"] in {"2026-04-23T15:30:00Z", "2026-04-23T15:40:00Z"}
    assert payload["rows"] != []


def test_replay_snapshot_returns_empty_for_unknown_session() -> None:
    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "missing-session", "at": "2026-04-23T16:00:00Z"},
    )

    assert response.status_code == 200
    payload = response.json()
    AnalyticsSnapshot.model_validate(payload)
    assert payload["coverage_status"] == "empty"
    assert payload["rows"] == []


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


def test_scenario_prefers_matching_ingested_live_snapshot() -> None:
    events = [
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
            "session_id": "live-spx-local-mock",
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
            "session_id": "live-spx-local-mock",
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
            "session_id": "live-spx-local-mock",
            "contract_id": "SPX-2026-04-24-P-5200",
            "ibkr_con_id": 900001,
            "symbol": "SPX",
            "expiry": "2026-04-24",
            "right": "put",
            "strike": 5200,
            "multiplier": 100,
            "exchange": "CBOE",
            "currency": "USD",
            "event_time": "2026-04-24T15:30:00Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-spx-local-mock",
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
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-spx-local-mock",
            "contract_id": "SPX-2026-04-24-P-5200",
            "bid": 9.7,
            "ask": 9.9,
            "last": 9.8,
            "bid_size": 9,
            "ask_size": 11,
            "volume": 380,
            "open_interest": 2200,
            "ibkr_iv": 0.2,
            "ibkr_delta": -0.49,
            "ibkr_gamma": 0.017,
            "ibkr_vega": 0.9,
            "ibkr_theta": -1.0,
            "event_time": "2026-04-24T15:30:00Z",
            "quote_status": "valid",
        },
    ]
    request_payload = {
        "session_id": "live-spx-local-mock",
        "snapshot_time": "2026-04-24T15:30:00Z",
        "spot_shift_points": 10,
        "vol_shift_points": -0.5,
        "time_shift_minutes": -15,
    }

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.post("/api/spx/0dte/scenario", json=request_payload)

    assert response.status_code == 200
    payload = response.json()
    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "scenario"
    assert payload["session_id"] == "live-spx-local-mock"
    assert payload["spot"] == 5210.25
    assert len(payload["rows"]) == 2
    assert {row["contract_id"] for row in payload["rows"]} == {
        "SPX-2026-04-24-C-5200",
        "SPX-2026-04-24-P-5200",
    }
    assert payload["scenario_params"] == {
        "spot_shift_points": 10,
        "vol_shift_points": -0.5,
        "time_shift_minutes": -15,
    }


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


def test_saved_views_reject_invalid_payload() -> None:
    response = client.post(
        "/api/views",
        json={
            "view_id": "invalid-view",
            "owner_scope": "public_demo",
            "name": "Invalid view",
            "mode": "replay",
            "strike_window": {"levels_each_side": 0},
            "visible_charts": [],
            "created_at": "not-a-date",
        },
    )

    assert response.status_code == 422
