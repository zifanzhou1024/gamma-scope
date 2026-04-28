from __future__ import annotations

from fastapi.testclient import TestClient

from gammascope_api.heatmap.dependencies import reset_heatmap_repository_override, set_heatmap_repository_override
from gammascope_api.heatmap.repository import InMemoryHeatmapRepository
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


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(NullReplayRepository())
    set_heatmap_repository_override(InMemoryHeatmapRepository())
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_latest_state_cache_override()
    reset_heatmap_repository_override()


def test_latest_heatmap_route_returns_payload_from_collector_state() -> None:
    for event in _collector_events():
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/heatmap/latest?metric=vex")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionId"] == "live-route-session"
    assert payload["symbol"] == "SPX"
    assert payload["tradingClass"] == "SPXW"
    assert payload["expirationDate"] == "2026-04-28"
    assert payload["metric"] == "vex"
    assert payload["positionMode"] == "oi_proxy"
    assert payload["persistenceStatus"] == "persisted"
    assert payload["isLive"] is True
    assert payload["rows"]
    assert payload["rows"][0]["value"] == payload["rows"][0]["vex"]


def test_latest_heatmap_route_rejects_invalid_metric() -> None:
    response = client.get("/api/spx/0dte/heatmap/latest?metric=charm")

    assert response.status_code == 422


def test_latest_heatmap_route_fallback_does_not_write_configured_repository() -> None:
    repository = _RecordingHeatmapRepository()
    set_heatmap_repository_override(repository)

    response = client.get("/api/spx/0dte/heatmap/latest")

    assert response.status_code == 200
    assert response.json()["persistenceStatus"] == "skipped"
    assert repository.baseline_upserts == 0
    assert repository.snapshot_upserts == 0


def test_latest_heatmap_route_private_fallback_does_not_write_configured_repository(monkeypatch) -> None:
    monkeypatch.setenv("GAMMASCOPE_PRIVATE_MODE_ENABLED", "true")
    monkeypatch.setenv("GAMMASCOPE_ADMIN_TOKEN", "local-admin-token")
    repository = _RecordingHeatmapRepository()
    set_heatmap_repository_override(repository)
    for event in _collector_events():
        assert client.post(
            "/api/spx/0dte/collector/events",
            json=event,
            headers={"X-GammaScope-Admin-Token": "local-admin-token"},
        ).status_code == 200

    response = client.get("/api/spx/0dte/heatmap/latest")

    assert response.status_code == 200
    assert response.json()["sessionId"] != "live-route-session"
    assert response.json()["persistenceStatus"] == "skipped"
    assert repository.baseline_upserts == 0
    assert repository.snapshot_upserts == 0


class _RecordingHeatmapRepository(InMemoryHeatmapRepository):
    def __init__(self) -> None:
        super().__init__()
        self.baseline_upserts = 0
        self.snapshot_upserts = 0

    def upsert_oi_baseline(self, records):  # type: ignore[no-untyped-def]
        self.baseline_upserts += 1
        return super().upsert_oi_baseline(records)

    def upsert_heatmap_snapshot(self, payload):  # type: ignore[no-untyped-def]
        self.snapshot_upserts += 1
        return super().upsert_heatmap_snapshot(payload)


def _collector_events() -> list[dict]:
    return [
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "collector_id": "local-dev",
            "status": "connected",
            "ibkr_account_mode": "paper",
            "message": "live",
            "event_time": "2026-04-28T13:25:00Z",
            "received_time": "2026-04-28T13:25:00Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "live-route-session",
            "symbol": "SPX",
            "spot": 7000.0,
            "bid": 6999.5,
            "ask": 7000.5,
            "last": 7000.0,
            "mark": 7000.0,
            "event_time": "2026-04-28T13:25:01Z",
            "quote_status": "valid",
        },
        _contract("SPXW-2026-04-28-C-7010", "call", 7010),
        _contract("SPXW-2026-04-28-P-6990", "put", 6990),
        _option_tick("SPXW-2026-04-28-C-7010", 30),
        _option_tick("SPXW-2026-04-28-P-6990", 80),
    ]


def _contract(contract_id: str, right: str, strike: float) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": "live-route-session",
        "contract_id": contract_id,
        "ibkr_con_id": abs(hash(contract_id)) % 1_000_000,
        "symbol": "SPX",
        "expiry": "2026-04-28",
        "right": right,
        "strike": strike,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-28T13:25:00Z",
    }


def _option_tick(contract_id: str, open_interest: int) -> dict:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": "live-route-session",
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
