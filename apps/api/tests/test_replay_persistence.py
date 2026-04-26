from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    InMemoryLatestStateCache,
    latest_state_cache,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)
from gammascope_api.main import app
from gammascope_api.replay.capture import ReplayCaptureRecorder
from gammascope_api.replay.dependencies import (
    reset_replay_import_repository_override,
    reset_replay_repository_override,
    set_replay_repository_override,
)
from gammascope_api.replay.repository import PostgresReplayRepository


TEST_DATABASE_URL = "postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope"


@pytest.fixture()
def replay_repository() -> tuple[PostgresReplayRepository, list[str]]:
    repo = PostgresReplayRepository(TEST_DATABASE_URL)
    try:
        repo.ensure_schema()
    except Exception as exc:
        pytest.skip(f"Postgres replay persistence is unavailable: {exc}")

    session_ids: list[str] = []
    yield repo, session_ids

    for session_id in session_ids:
        repo.delete_session(session_id)


@pytest.fixture()
def api_client(replay_repository: tuple[PostgresReplayRepository, list[str]]) -> TestClient:
    repo, _session_ids = replay_repository
    collector_state.clear()
    set_latest_state_cache_override(InMemoryLatestStateCache())
    set_replay_repository_override(repo)
    try:
        yield TestClient(app)
    finally:
        collector_state.clear()
        reset_latest_state_cache_override()
        reset_replay_import_repository_override()
        reset_replay_repository_override()


def test_repository_lists_sessions_and_selects_nearest_snapshot(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-replay-{uuid4()}"
    session_ids.append(session_id)

    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:30:00Z", spot=5200.25, row_count=1), source="ibkr")
    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:40:00Z", spot=5210.25, row_count=2), source="ibkr")

    sessions = repo.list_sessions()
    session = next(item for item in sessions if item["session_id"] == session_id)
    nearest = repo.nearest_snapshot(session_id, "2026-04-24T15:36:00Z")

    assert session == {
        "session_id": session_id,
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "start_time": "2026-04-24T15:30:00Z",
        "end_time": "2026-04-24T15:40:00Z",
        "snapshot_count": 2,
        "source": "ibkr",
        "timestamp_source": "estimated",
    }
    assert nearest is not None
    assert nearest["snapshot_time"] == "2026-04-24T15:40:00Z"
    assert nearest["spot"] == 5210.25


def test_repository_does_not_list_sessions_without_snapshots(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    healthy_session_id = f"pytest-replay-healthy-{uuid4()}"
    stale_session_id = f"pytest-replay-stale-{uuid4()}"
    session_ids.extend([healthy_session_id, stale_session_id])

    repo.insert_snapshot(_snapshot(healthy_session_id, "2026-04-24T15:30:00Z"), source="ibkr")
    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO replay_sessions (
                    session_id, symbol, expiry, source, start_time, end_time, snapshot_count
                )
                VALUES (%s, 'SPX', '2026-04-24', 'ibkr', %s, %s, 2)
                """,
                (stale_session_id, "2026-04-24T15:40:00Z", "2026-04-24T15:50:00Z"),
            )

    session_ids_from_repo = {session["session_id"] for session in repo.list_sessions()}

    assert healthy_session_id in session_ids_from_repo
    assert stale_session_id not in session_ids_from_repo


def test_repository_lists_replay_snapshots_in_chronological_order_from_requested_start(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-replay-{uuid4()}"
    session_ids.append(session_id)

    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:50:00Z", spot=5250.25), source="ibkr")
    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:30:00Z", spot=5230.25), source="ibkr")
    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:40:00Z", spot=5240.25), source="ibkr")

    snapshots = repo.replay_snapshots(session_id, "2026-04-24T15:35:00Z")

    assert [snapshot["snapshot_time"] for snapshot in snapshots] == [
        "2026-04-24T15:40:00Z",
        "2026-04-24T15:50:00Z",
    ]
    assert [snapshot["spot"] for snapshot in snapshots] == [5240.25, 5250.25]


def test_repository_updates_latest_snapshot_without_duplicating_capture_bucket(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-replay-{uuid4()}"
    session_ids.append(session_id)

    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:30:00Z", row_count=1), source="ibkr")
    latest = repo.latest_snapshot_summary(session_id)
    assert latest is not None

    repo.update_snapshot(
        latest["snapshot_id"],
        _snapshot(session_id, "2026-04-24T15:30:03Z", spot=5202.25, row_count=3),
        source="ibkr",
    )

    session = next(item for item in repo.list_sessions() if item["session_id"] == session_id)
    nearest = repo.nearest_snapshot(session_id, "2026-04-24T15:30:04Z")

    assert session["snapshot_count"] == 1
    assert session["end_time"] == "2026-04-24T15:30:03Z"
    assert nearest is not None
    assert nearest["snapshot_time"] == "2026-04-24T15:30:03Z"
    assert nearest["spot"] == 5202.25
    assert len(nearest["rows"]) == 3


def test_collector_ingestion_persists_replay_ready_snapshot_and_prefers_it_before_seed(
    api_client: TestClient,
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    _repo, session_ids = replay_repository
    session_id = f"pytest-live-{uuid4()}"
    session_ids.append(session_id)

    for event in _live_events(session_id):
        assert api_client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    sessions_response = api_client.get("/api/spx/0dte/replay/sessions")
    snapshot_response = api_client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": session_id, "at": "2026-04-24T15:30:03Z"},
    )

    assert sessions_response.status_code == 200
    sessions = sessions_response.json()
    session_ids = [session["session_id"] for session in sessions]
    persisted_session = next(session for session in sessions if session["session_id"] == session_id)
    assert persisted_session["snapshot_count"] == 1
    assert session_ids.index(session_id) < session_ids.index("seed-spx-2026-04-23")

    assert snapshot_response.status_code == 200
    payload = snapshot_response.json()
    AnalyticsSnapshot.model_validate(payload)
    assert payload["mode"] == "replay"
    assert payload["session_id"] == session_id
    assert payload["snapshot_time"] == "2026-04-24T15:30:03Z"
    assert len(payload["rows"]) == 2


def test_api_client_fixture_uses_in_memory_latest_state_cache(api_client: TestClient) -> None:
    assert isinstance(latest_state_cache(), InMemoryLatestStateCache)


def test_capture_throttle_inserts_new_snapshot_after_interval(
    api_client: TestClient,
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-live-{uuid4()}"
    session_ids.append(session_id)

    for event in _live_events(session_id):
        assert api_client.post("/api/spx/0dte/collector/events", json=event).status_code == 200

    assert api_client.post(
        "/api/spx/0dte/collector/events",
        json=_option_tick(session_id, "SPX-2026-04-24-C-5200", "2026-04-24T15:30:09Z", bid=10.5, ask=10.7),
    ).status_code == 200

    session = next(item for item in repo.list_sessions() if item["session_id"] == session_id)
    latest = repo.nearest_snapshot(session_id, "2026-04-24T15:30:09Z")

    assert session["snapshot_count"] == 2
    assert latest is not None
    assert latest["snapshot_time"] == "2026-04-24T15:30:09Z"


def test_capture_ignores_stale_snapshot_older_than_latest(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-live-{uuid4()}"
    session_ids.append(session_id)
    recorder = ReplayCaptureRecorder(repo, interval_seconds=5)

    latest_result = recorder.capture(_live_snapshot(session_id, "2026-04-24T15:30:09Z", spot=5209.25, row_count=2))
    stale_result = recorder.capture(_live_snapshot(session_id, "2026-04-24T15:30:03Z", spot=5203.25, row_count=1))
    session = next(item for item in repo.list_sessions() if item["session_id"] == session_id)
    latest = repo.nearest_snapshot(session_id, "2026-04-24T15:30:09Z")

    assert latest_result["captured"] is True
    assert stale_result == {"captured": False, "reason": "stale_snapshot"}
    assert session["snapshot_count"] == 1
    assert latest is not None
    assert latest["snapshot_time"] == "2026-04-24T15:30:09Z"
    assert latest["spot"] == 5209.25
    assert len(latest["rows"]) == 2


def test_repository_update_missing_snapshot_id_falls_back_to_insert(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-replay-{uuid4()}"
    session_ids.append(session_id)

    summary = repo.update_snapshot(
        999_999_999,
        _snapshot(session_id, "2026-04-24T15:30:00Z", spot=5200.25, row_count=2),
        source="ibkr",
    )
    session = next(item for item in repo.list_sessions() if item["session_id"] == session_id)

    assert summary["session_id"] == session_id
    assert summary["row_count"] == 2
    assert session["snapshot_count"] == 1
    assert session["start_time"] == "2026-04-24T15:30:00Z"


def test_repository_update_across_sessions_refreshes_old_session_summary(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    first_session_id = f"pytest-replay-a-{uuid4()}"
    second_session_id = f"pytest-replay-b-{uuid4()}"
    session_ids.extend([first_session_id, second_session_id])

    first_summary = repo.insert_snapshot(_snapshot(first_session_id, "2026-04-24T15:30:00Z"), source="ibkr")
    repo.insert_snapshot(_snapshot(first_session_id, "2026-04-24T15:35:00Z"), source="ibkr")

    repo.update_snapshot(
        first_summary["snapshot_id"],
        _snapshot(second_session_id, "2026-04-24T15:40:00Z", spot=5240.25),
        source="ibkr",
    )

    sessions = {session["session_id"]: session for session in repo.list_sessions()}
    assert sessions[first_session_id]["snapshot_count"] == 1
    assert sessions[first_session_id]["start_time"] == "2026-04-24T15:35:00Z"
    assert sessions[second_session_id]["snapshot_count"] == 1
    assert sessions[second_session_id]["start_time"] == "2026-04-24T15:40:00Z"


def test_repository_nearest_snapshot_prefers_newest_payload_for_same_timestamp(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    session_id = f"pytest-replay-{uuid4()}"
    session_ids.append(session_id)

    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:30:00Z", spot=5200.25), source="ibkr")
    repo.insert_snapshot(_snapshot(session_id, "2026-04-24T15:30:00Z", spot=5210.25), source="ibkr")

    nearest = repo.nearest_snapshot(session_id, "2026-04-24T15:30:00Z")

    assert nearest is not None
    assert nearest["spot"] == 5210.25


def test_repository_cleanup_old_snapshots_refreshes_sessions(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    cleanup_prefix = f"pytest-cleanup-{uuid4()}"
    mixed_session_id = f"{cleanup_prefix}-mixed"
    old_only_session_id = f"{cleanup_prefix}-old"
    unrelated_old_session_id = f"pytest-unrelated-old-{uuid4()}"
    session_ids.extend([mixed_session_id, old_only_session_id])

    repo.insert_snapshot(_snapshot(mixed_session_id, "2026-03-01T15:30:00Z", spot=5100.25), source="ibkr")
    repo.insert_snapshot(_snapshot(mixed_session_id, "2026-04-24T15:40:00Z", spot=5200.25), source="ibkr")
    repo.insert_snapshot(_snapshot(old_only_session_id, "2026-03-01T15:35:00Z", spot=5110.25), source="ibkr")
    repo.insert_snapshot(_snapshot(unrelated_old_session_id, "2026-03-01T15:45:00Z", spot=5120.25), source="ibkr")
    session_ids.append(unrelated_old_session_id)

    dry_run = repo.cleanup_before("2026-04-01T00:00:00Z", dry_run=True, session_id_prefix=cleanup_prefix)
    assert dry_run == {"snapshots": 2, "sessions": 1}
    assert {session["session_id"] for session in repo.list_sessions()} >= {
        mixed_session_id,
        old_only_session_id,
        unrelated_old_session_id,
    }

    deleted = repo.cleanup_before("2026-04-01T00:00:00Z", dry_run=False, session_id_prefix=cleanup_prefix)

    sessions = {session["session_id"]: session for session in repo.list_sessions()}
    assert deleted == {"snapshots": 2, "sessions": 1}
    assert old_only_session_id not in sessions
    assert unrelated_old_session_id in sessions
    assert sessions[mixed_session_id]["snapshot_count"] == 1
    assert sessions[mixed_session_id]["start_time"] == "2026-04-24T15:40:00Z"
    assert sessions[mixed_session_id]["end_time"] == "2026-04-24T15:40:00Z"
    assert repo.nearest_snapshot(mixed_session_id)["spot"] == 5200.25


def test_repository_filters_imported_metadata_from_jsonb_replay_session_list(
    replay_repository: tuple[PostgresReplayRepository, list[str]],
) -> None:
    repo, session_ids = replay_repository
    live_session_id = f"pytest-live-jsonb-{uuid4()}"
    imported_session_id = f"pytest-import-jsonb-{uuid4()}"
    session_ids.extend([live_session_id, imported_session_id])

    repo.insert_snapshot(_snapshot(live_session_id, "2026-04-24T15:30:00Z"), source="ibkr")
    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO replay_sessions (
                    session_id, symbol, expiry, source, start_time, end_time, snapshot_count
                )
                VALUES (%s, 'SPX', '2026-04-24', 'parquet_import', %s, %s, 2)
                """,
                (imported_session_id, "2026-04-24T14:30:00Z", "2026-04-24T14:40:00Z"),
            )

    session_ids_from_jsonb_repo = {session["session_id"] for session in repo.list_sessions()}

    assert live_session_id in session_ids_from_jsonb_repo
    assert imported_session_id not in session_ids_from_jsonb_repo


def test_seeded_replay_still_works_when_repository_has_no_session(api_client: TestClient) -> None:
    response = api_client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T15:30:00Z"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "seed-spx-2026-04-23"
    assert payload["mode"] == "replay"
    assert payload["rows"] != []


def _snapshot(session_id: str, snapshot_time: str, *, spot: float = 5200.25, row_count: int = 1) -> dict:
    snapshot = deepcopy(load_json_fixture("analytics-snapshot.seed.json"))
    snapshot["session_id"] = session_id
    snapshot["mode"] = "replay"
    snapshot["expiry"] = "2026-04-24"
    snapshot["snapshot_time"] = snapshot_time
    snapshot["spot"] = spot
    snapshot["forward"] = spot
    snapshot["rows"] = snapshot["rows"][:row_count]
    return snapshot


def _live_snapshot(session_id: str, snapshot_time: str, *, spot: float = 5200.25, row_count: int = 1) -> dict:
    snapshot = _snapshot(session_id, snapshot_time, spot=spot, row_count=row_count)
    snapshot["mode"] = "live"
    return snapshot


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
        _contract(session_id, "SPX-2026-04-24-C-5200", "call", 900000),
        _contract(session_id, "SPX-2026-04-24-P-5200", "put", 900001),
        _option_tick(session_id, "SPX-2026-04-24-C-5200", "2026-04-24T15:30:02Z", bid=9.9, ask=10.1),
        _option_tick(session_id, "SPX-2026-04-24-P-5200", "2026-04-24T15:30:03Z", bid=9.7, ask=9.9),
    ]


def _contract(session_id: str, contract_id: str, right: str, con_id: int) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": con_id,
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "right": right,
        "strike": 5200,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": "2026-04-24T15:30:00Z",
    }


def _option_tick(session_id: str, contract_id: str, event_time: str, *, bid: float, ask: float) -> dict[str, object]:
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


def _connect():
    import psycopg

    return psycopg.connect(TEST_DATABASE_URL, connect_timeout=2)
