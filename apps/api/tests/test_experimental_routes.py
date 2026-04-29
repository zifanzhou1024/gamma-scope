from __future__ import annotations

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
from gammascope_api.main import app
from gammascope_api.routes import experimental as experimental_routes


client = TestClient(app)


def setup_function() -> None:
    collector_state.clear()
    reset_live_snapshot_memory()
    set_latest_state_cache_override(InMemoryLatestStateCache())


def teardown_function() -> None:
    reset_latest_state_cache_override()


def test_latest_experimental_route_falls_back_to_seed_payload() -> None:
    response = client.get("/api/spx/0dte/experimental/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"
    assert payload["forwardSummary"]["status"] == "ok"


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
