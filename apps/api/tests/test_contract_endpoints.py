from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.ingestion.live_snapshot import reset_live_snapshot_memory
from gammascope_api.main import app
from gammascope_api.replay.capture import reset_replay_capture_circuit
from gammascope_api.replay.dependencies import set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository
from gammascope_api.saved_views.dependencies import (
    reset_saved_view_repository_override,
    set_saved_view_repository_override,
)
from gammascope_api.saved_views.repository import InMemorySavedViewRepository


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(NullReplayRepository())
    set_saved_view_repository_override(InMemorySavedViewRepository())
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_latest_state_cache_override()
    reset_saved_view_repository_override()


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


def test_live_snapshot_reuses_last_good_custom_analytics_when_current_quote_is_unusable() -> None:
    session_id = "live-spx-analytics-memory"
    contract_id = "SPX-2026-04-24-C-5200"
    events = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event(session_id, "2026-04-24T15:30:00Z", 5200.25),
        _contract_event(session_id, contract_id, "call", "2026-04-24T15:30:00Z"),
        _option_event(session_id, contract_id, "2026-04-24T15:30:02Z", bid=9.9, ask=10.1),
    ]

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    valid_payload = client.get("/api/spx/0dte/snapshot/latest").json()
    valid_row = valid_payload["rows"][0]
    assert valid_row["calc_status"] == "ok"
    assert valid_row["custom_iv"] is not None
    assert valid_row["custom_gamma"] is not None
    assert valid_row["custom_vanna"] is not None

    for event in [
        _underlying_event(session_id, "2026-04-24T15:31:00Z", 5210.25),
        _option_event(session_id, contract_id, "2026-04-24T15:31:00Z", bid=1.0, ask=1.2),
    ]:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    stale_payload = client.get("/api/spx/0dte/snapshot/latest").json()
    stale_row = stale_payload["rows"][0]
    AnalyticsSnapshot.model_validate(stale_payload)
    assert stale_row["calc_status"] == "below_intrinsic"
    assert stale_row["custom_iv"] == valid_row["custom_iv"]
    assert stale_row["custom_gamma"] == valid_row["custom_gamma"]
    assert stale_row["custom_vanna"] == valid_row["custom_vanna"]
    assert stale_row["iv_diff"] == stale_row["custom_iv"] - stale_row["ibkr_iv"]
    assert stale_row["gamma_diff"] == stale_row["custom_gamma"] - stale_row["ibkr_gamma"]


def test_live_snapshot_uses_raw_iv_for_first_unusable_quote_without_memory() -> None:
    session_id = "live-spx-raw-iv-fallback"
    contract_id = "SPX-2026-04-24-C-5200"
    events = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event(session_id, "2026-04-24T15:30:00Z", 5210.25),
        _contract_event(session_id, contract_id, "call", "2026-04-24T15:30:00Z"),
        _option_event(session_id, contract_id, "2026-04-24T15:30:02Z", bid=1.0, ask=1.2),
    ]

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    payload = client.get("/api/spx/0dte/snapshot/latest").json()
    row = payload["rows"][0]
    AnalyticsSnapshot.model_validate(payload)
    assert row["calc_status"] == "below_intrinsic"
    assert row["custom_iv"] == row["ibkr_iv"]
    assert row["custom_gamma"] is not None
    assert row["custom_vanna"] is not None
    assert row["iv_diff"] == 0
    assert row["gamma_diff"] == row["custom_gamma"] - row["ibkr_gamma"]


def test_latest_readers_prefer_cached_collector_state_after_process_memory_clear() -> None:
    session_id = "cached-live-session"
    events = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event(session_id, "2026-04-24T15:30:00Z", 5300.25),
        _contract_event(session_id, "SPX-2026-04-24-C-5300", "call", "2026-04-24T15:30:00Z"),
        _option_event(session_id, "SPX-2026-04-24-C-5300", "2026-04-24T15:30:02Z"),
    ]

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200
    collector_state.clear()

    state_response = client.get("/api/spx/0dte/collector/state")
    status_response = client.get("/api/spx/0dte/status")
    snapshot_response = client.get("/api/spx/0dte/snapshot/latest")
    scenario_response = client.post(
        "/api/spx/0dte/scenario",
        json={
            "session_id": session_id,
            "snapshot_time": "2026-04-24T15:30:02Z",
            "spot_shift_points": 5,
            "vol_shift_points": 0,
            "time_shift_minutes": 0,
        },
    )

    assert state_response.status_code == 200
    assert state_response.json()["contracts_count"] == 1
    assert state_response.json()["last_event_time"] == "2026-04-24T15:30:02Z"
    assert status_response.status_code == 200
    assert status_response.json()["message"] == "Mock live cycle"
    assert snapshot_response.status_code == 200
    snapshot_payload = snapshot_response.json()
    AnalyticsSnapshot.model_validate(snapshot_payload)
    assert snapshot_payload["mode"] == "live"
    assert snapshot_payload["session_id"] == session_id
    assert snapshot_payload["spot"] == 5300.25
    assert scenario_response.status_code == 200
    scenario_payload = scenario_response.json()
    assert scenario_payload["mode"] == "scenario"
    assert scenario_payload["session_id"] == session_id
    assert scenario_payload["spot"] == 5305.25


def test_collector_ingest_continues_when_latest_state_cache_write_fails() -> None:
    set_latest_state_cache_override(FailingLatestStateCache())
    session_id = "cache-failure-live-session"

    responses = [
        client.post("/api/spx/0dte/collector/events", json=event)
        for event in [
            _health_event("2026-04-24T15:30:00Z"),
            _underlying_event(session_id, "2026-04-24T15:30:00Z", 5200.25),
            _contract_event(session_id, "SPX-2026-04-24-C-5200", "call", "2026-04-24T15:30:00Z"),
            _option_event(session_id, "SPX-2026-04-24-C-5200", "2026-04-24T15:30:02Z"),
        ]
    ]

    assert all(response.status_code == 200 for response in responses)
    assert all(response.json()["accepted"] is True for response in responses)
    assert client.get("/api/spx/0dte/status").json()["message"] == "Mock live cycle"
    snapshot_payload = client.get("/api/spx/0dte/snapshot/latest").json()
    assert snapshot_payload["mode"] == "live"
    assert snapshot_payload["session_id"] == session_id


def test_latest_readers_use_memory_when_cache_is_stale_and_cache_writes_fail() -> None:
    session_id = "fresh-memory-session"
    set_latest_state_cache_override(
        StaleReadFailingWriteLatestStateCache(
            {
                "health_events": {
                    "local-dev": {
                        **_health_event("2026-04-24T15:29:00Z"),
                        "message": "Stale cached health",
                    }
                },
                "contracts": {},
                "underlying_ticks": {},
                "option_ticks": {},
                "last_event_time": "2026-04-24T15:29:00Z",
            }
        )
    )
    fresh_health = {**_health_event("2026-04-24T15:30:00Z"), "message": "Fresh in-memory health"}
    events = [
        fresh_health,
        _underlying_event(session_id, "2026-04-24T15:30:01Z", 5310.25),
        _contract_event(session_id, "SPX-2026-04-24-C-5310", "call", "2026-04-24T15:30:01Z"),
        _option_event(session_id, "SPX-2026-04-24-C-5310", "2026-04-24T15:30:02Z"),
    ]

    for event in events:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    state_response = client.get("/api/spx/0dte/collector/state")
    status_response = client.get("/api/spx/0dte/status")
    snapshot_response = client.get("/api/spx/0dte/snapshot/latest")

    assert state_response.status_code == 200
    assert state_response.json()["contracts_count"] == 1
    assert state_response.json()["last_event_time"] == "2026-04-24T15:30:02Z"
    assert status_response.status_code == 200
    assert status_response.json()["message"] == "Fresh in-memory health"
    assert snapshot_response.status_code == 200
    snapshot_payload = snapshot_response.json()
    AnalyticsSnapshot.model_validate(snapshot_payload)
    assert snapshot_payload["mode"] == "live"
    assert snapshot_payload["session_id"] == session_id
    assert snapshot_payload["spot"] == 5310.25


def test_latest_snapshot_does_not_mix_rows_from_previous_session() -> None:
    previous_session_events = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event("previous-session", "2026-04-24T15:30:00Z", 5200.25),
        _contract_event("previous-session", "SPX-2026-04-24-C-5200", "call", "2026-04-24T15:30:00Z"),
        _option_event("previous-session", "SPX-2026-04-24-C-5200", "2026-04-24T15:30:01Z"),
    ]
    new_session_events = [
        _underlying_event("new-session", "2026-04-24T15:31:00Z", 5210.25),
    ]

    for event in [*previous_session_events, *new_session_events]:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/snapshot/latest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "replay"
    assert payload["session_id"] == "seed-spx-2026-04-23"


def test_replay_snapshot_reports_unavailable_when_repository_fails_for_non_seed_session() -> None:
    set_replay_repository_override(FailingReplayRepository())

    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "captured-session", "at": "2026-04-24T15:30:00Z"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Replay persistence unavailable"


def test_collector_ingest_skips_replay_capture_temporarily_after_persistence_failure() -> None:
    repository = FailingReplayRepository()
    set_replay_repository_override(repository)
    events = [
        _health_event("2026-04-24T15:30:00Z"),
        _underlying_event("live-spx-local-mock", "2026-04-24T15:30:00Z", 5200.25),
        _contract_event("live-spx-local-mock", "SPX-2026-04-24-C-5200", "call", "2026-04-24T15:30:00Z"),
        _option_event("live-spx-local-mock", "SPX-2026-04-24-C-5200", "2026-04-24T15:30:01Z"),
        _option_event("live-spx-local-mock", "SPX-2026-04-24-C-5200", "2026-04-24T15:30:02Z", bid=10.2, ask=10.4),
    ]

    responses = [client.post("/api/spx/0dte/collector/events", json=event) for event in events]

    assert all(response.status_code == 200 for response in responses)
    capture_responses = [
        response.json()["replay_capture"]
        for response in responses
        if response.json()["replay_capture"]["reason"] != "snapshot_not_ready"
    ]
    assert repository.calls == 1
    assert capture_responses[0]["reason"] == "persistence_unavailable"
    assert capture_responses[1]["reason"] == "persistence_unavailable_recently"


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
    session = next(
        session
        for session in response.json()
        if session["session_id"] == "seed-spx-2026-04-23"
    )
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


def test_saved_views_round_trip_via_repository_override() -> None:
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


def test_saved_views_upsert_without_process_global_route_list() -> None:
    original_view = {
        "view_id": "saved-view-upsert",
        "owner_scope": "public_demo",
        "name": "Original view",
        "mode": "replay",
        "strike_window": {"levels_each_side": 20},
        "visible_charts": ["iv_smile"],
        "created_at": "2026-04-23T16:00:00Z",
    }
    updated_view = {
        **original_view,
        "name": "Updated view",
        "mode": "scenario",
        "created_at": "2026-04-24T16:00:00Z",
    }

    first_response = client.post("/api/views", json=original_view)
    second_response = client.post("/api/views", json=updated_view)
    list_response = client.get("/api/views")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["name"] == "Updated view"
    matching_views = [view for view in list_response.json() if view["view_id"] == "saved-view-upsert"]
    assert matching_views == [updated_view]


def test_saved_views_fall_back_to_memory_when_repository_unavailable() -> None:
    set_saved_view_repository_override(FailingSavedViewRepository())
    view = {
        "view_id": "fallback-view",
        "owner_scope": "public_demo",
        "name": "Fallback view",
        "mode": "live",
        "strike_window": {"levels_each_side": 10},
        "visible_charts": ["iv_smile"],
        "created_at": "2026-04-25T16:00:00Z",
    }

    create_response = client.post("/api/views", json=view)
    list_response = client.get("/api/views")

    assert create_response.status_code == 200
    assert create_response.json() == view
    assert list_response.status_code == 200
    assert list_response.json() == [view]


def test_saved_views_keep_using_fallback_after_save_failure() -> None:
    set_saved_view_repository_override(SaveFailingSavedViewRepository())
    view = {
        "view_id": "fallback-after-save-failure",
        "owner_scope": "public_demo",
        "name": "Fallback after save failure",
        "mode": "replay",
        "strike_window": {"levels_each_side": 12},
        "visible_charts": ["gamma_by_strike"],
        "created_at": "2026-04-25T17:00:00Z",
    }

    create_response = client.post("/api/views", json=view)
    list_response = client.get("/api/views")

    assert create_response.status_code == 200
    assert create_response.json() == view
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


class FailingReplayRepository:
    def __init__(self) -> None:
        self.calls = 0

    def ensure_schema(self) -> None:
        self.calls += 1
        raise RuntimeError("database unavailable")

    def insert_snapshot(self, snapshot, *, source: str):
        self.calls += 1
        raise RuntimeError("database unavailable")

    def update_snapshot(self, snapshot_id: int, snapshot, *, source: str):
        self.calls += 1
        raise RuntimeError("database unavailable")

    def latest_snapshot_summary(self, session_id: str):
        self.calls += 1
        raise RuntimeError("database unavailable")

    def list_sessions(self):
        self.calls += 1
        raise RuntimeError("database unavailable")

    def nearest_snapshot(self, session_id: str, at: str | None = None):
        self.calls += 1
        raise RuntimeError("database unavailable")


class FailingLatestStateCache:
    def get(self):
        raise RuntimeError("redis unavailable")

    def set(self, state):
        raise RuntimeError("redis unavailable")

    def clear(self) -> None:
        raise RuntimeError("redis unavailable")


class StaleReadFailingWriteLatestStateCache:
    def __init__(self, state):
        self.state = state

    def get(self):
        return self.state

    def set(self, state):
        raise RuntimeError("redis unavailable")

    def clear(self) -> None:
        self.state = None


class FailingSavedViewRepository:
    def ensure_schema(self) -> None:
        raise RuntimeError("database unavailable")

    def save_view(self, payload):
        raise RuntimeError("database unavailable")

    def list_views(self):
        raise RuntimeError("database unavailable")


class SaveFailingSavedViewRepository:
    def ensure_schema(self) -> None:
        return None

    def save_view(self, payload):
        raise RuntimeError("database unavailable")

    def list_views(self):
        return []


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


def _underlying_event(session_id: str, event_time: str, spot: float) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "symbol": "SPX",
        "spot": spot,
        "bid": spot - 0.5,
        "ask": spot + 0.5,
        "last": spot,
        "mark": spot,
        "event_time": event_time,
        "quote_status": "valid",
    }


def _contract_event(session_id: str, contract_id: str, right: str, event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": 900000,
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "right": right,
        "strike": 5200,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": event_time,
    }


def _option_event(
    session_id: str,
    contract_id: str,
    event_time: str,
    *,
    bid: float = 9.9,
    ask: float = 10.1,
) -> dict[str, object]:
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
        "event_time": event_time,
        "quote_status": "valid",
    }
