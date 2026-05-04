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
from gammascope_api.ingestion.live_snapshot_service import reset_live_snapshot_service_override
from gammascope_api.main import app
from gammascope_api.replay.capture import reset_replay_capture_circuit
from gammascope_api.replay.dependencies import reset_replay_repository_override, set_replay_repository_override
from gammascope_api.replay.repository import NullReplayRepository


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    reset_live_snapshot_service_override()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(NullReplayRepository())
    set_heatmap_repository_override(InMemoryHeatmapRepository())
    reset_replay_capture_circuit()


def teardown_function() -> None:
    reset_live_snapshot_service_override()
    reset_latest_state_cache_override()
    reset_replay_repository_override()
    reset_heatmap_repository_override()


def test_latest_heatmap_route_returns_payload_from_collector_state() -> None:
    for event in _collector_events():
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/heatmap/latest?metric=vex")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionId"] == "moomoo-spx-0dte-live"
    assert payload["symbol"] == "SPX"
    assert payload["tradingClass"] == "SPXW"
    assert payload["expirationDate"] == "2026-04-28"
    assert payload["metric"] == "vex"
    assert payload["positionMode"] == "oi_proxy"
    assert payload["persistenceStatus"] == "persisted"
    assert payload["isLive"] is True
    assert payload["rows"]
    assert payload["rows"][0]["value"] == payload["rows"][0]["vex"]


def test_latest_heatmap_route_reuses_latest_moomoo_replay_snapshot_when_collector_state_is_empty() -> None:
    repository = _RecordingHeatmapRepository()
    set_heatmap_repository_override(repository)
    set_replay_repository_override(
        _ReplayRepositoryWithSnapshot(
            {
                "schema_version": "1.0.0",
                "session_id": "moomoo-spx-0dte-live",
                "mode": "replay",
                "symbol": "SPX",
                "expiry": "2026-04-28",
                "snapshot_time": "2026-04-28T13:25:00Z",
                "spot": 7000,
                "freshness_ms": 500,
                "rows": [
                    _snapshot_row("SPX-2026-04-28-C-7010", "call", 7010, 30),
                    _snapshot_row("SPX-2026-04-28-P-6990", "put", 6990, 80),
                ],
            }
        )
    )

    response = client.get("/api/spx/0dte/heatmap/latest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionId"] == "moomoo-spx-0dte-live"
    assert payload["isLive"] is True
    assert payload["persistenceStatus"] == "persisted"
    assert repository.baseline_upserts == 1
    assert repository.snapshot_upserts == 1
    assert {row["strike"] for row in payload["rows"]} == {6990.0, 7010.0}


def test_latest_heatmap_route_returns_requested_symbol_from_collector_state() -> None:
    for event in [
        _health_event("2026-04-28T13:25:00Z"),
        _underlying_event("moomoo-spx-0dte-live", "SPX", 7000.0, "2026-04-28T13:25:01Z"),
        _contract("SPX-2026-04-28-C-7010", "call", 7010, "moomoo-spx-0dte-live", "SPX"),
        _option_tick("SPX-2026-04-28-C-7010", 30, "moomoo-spx-0dte-live"),
        _underlying_event("moomoo-spy-0dte-live", "SPY", 700.0, "2026-04-28T13:25:02Z"),
        _contract("SPY-2026-04-28-C-701", "call", 701, "moomoo-spy-0dte-live", "SPY"),
        _option_tick("SPY-2026-04-28-C-701", 40, "moomoo-spy-0dte-live"),
        _underlying_event("moomoo-ndx-0dte-live", "NDX", 18300.0, "2026-04-28T13:25:03Z"),
        _contract("NDX-2026-04-28-C-18300", "call", 18300, "moomoo-ndx-0dte-live", "NDX"),
        _option_tick("NDX-2026-04-28-C-18300", 20, "moomoo-ndx-0dte-live"),
        _underlying_event("moomoo-iwm-0dte-live", "IWM", 277.0, "2026-04-28T13:25:04Z"),
        _contract("IWM-2026-04-28-C-277", "call", 277, "moomoo-iwm-0dte-live", "IWM"),
        _option_tick("IWM-2026-04-28-C-277", 50, "moomoo-iwm-0dte-live"),
    ]:
        assert client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    response = client.get("/api/spx/0dte/heatmap/latest?symbol=NDX")

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionId"] == "moomoo-ndx-0dte-live"
    assert payload["symbol"] == "NDX"
    assert payload["tradingClass"] == "NDX"
    assert {row["strike"] for row in payload["rows"]} == {18300.0}

    iwm_response = client.get("/api/spx/0dte/heatmap/latest?symbol=IWM")

    assert iwm_response.status_code == 200
    iwm_payload = iwm_response.json()
    assert iwm_payload["sessionId"] == "moomoo-iwm-0dte-live"
    assert iwm_payload["symbol"] == "IWM"
    assert iwm_payload["tradingClass"] == "IWM"
    assert {row["strike"] for row in iwm_payload["rows"]} == {277.0}


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


def test_latest_heatmap_route_private_mode_returns_public_live_heatmap(monkeypatch) -> None:
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
    assert response.json()["sessionId"] == "moomoo-spx-0dte-live"
    assert response.json()["persistenceStatus"] == "persisted"
    assert repository.baseline_upserts == 1
    assert repository.snapshot_upserts == 1


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


class _ReplayRepositoryWithSnapshot(NullReplayRepository):
    def __init__(self, snapshot: dict) -> None:
        self.snapshot = snapshot

    def nearest_snapshot(self, session_id: str, at: str | None = None) -> dict | None:
        if session_id != "moomoo-spx-0dte-live":
            return None
        return self.snapshot


def _collector_events() -> list[dict]:
    return [
        _health_event("2026-04-28T13:25:00Z"),
        _underlying_event("moomoo-spx-0dte-live", "SPX", 7000.0, "2026-04-28T13:25:01Z"),
        _contract("SPXW-2026-04-28-C-7010", "call", 7010),
        _contract("SPXW-2026-04-28-P-6990", "put", 6990),
        _option_tick("SPXW-2026-04-28-C-7010", 30),
        _option_tick("SPXW-2026-04-28-P-6990", 80),
    ]


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


def _contract(
    contract_id: str,
    right: str,
    strike: float,
    session_id: str = "moomoo-spx-0dte-live",
    symbol: str = "SPX",
) -> dict:
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


def _option_tick(contract_id: str, open_interest: int, session_id: str = "moomoo-spx-0dte-live") -> dict:
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


def _snapshot_row(contract_id: str, right: str, strike: float, open_interest: int) -> dict:
    return {
        "contract_id": contract_id,
        "right": right,
        "strike": strike,
        "open_interest": open_interest,
        "custom_gamma": 0.001,
        "custom_vanna": 0.05,
    }
