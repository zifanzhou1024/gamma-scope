from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.replay.dependencies import get_replay_import_repository, get_replay_repository
from gammascope_api.replay.imported_snapshot import build_imported_analytics_snapshot


router = APIRouter()
IMPORTED_REPLAY_UNAVAILABLE_DETAIL = "Imported replay persistence unavailable"

REPLAY_TIMES = [
    "2026-04-23T15:30:00Z",
    "2026-04-23T15:40:00Z",
    "2026-04-23T15:50:00Z",
    "2026-04-23T16:00:00Z",
]


@router.get("/api/spx/0dte/replay/sessions")
def list_replay_sessions() -> list[dict]:
    imported_sessions = _completed_imported_replay_sessions()
    persisted_sessions = _persisted_replay_sessions()
    snapshots = seed_replay_snapshots()
    first_snapshot = snapshots[0]
    last_snapshot = snapshots[-1]
    return [
        *imported_sessions,
        *persisted_sessions,
        {
            "session_id": first_snapshot["session_id"],
            "symbol": first_snapshot["symbol"],
            "expiry": first_snapshot["expiry"],
            "start_time": first_snapshot["snapshot_time"],
            "end_time": last_snapshot["snapshot_time"],
            "snapshot_count": len(snapshots),
            "timestamp_source": "estimated",
        }
    ]


@router.get("/api/spx/0dte/replay/sessions/{session_id}/timestamps")
def get_replay_session_timestamps(session_id: str) -> dict[str, Any]:
    entries = _imported_replay_timestamps(session_id) if _is_completed_imported_session(session_id) else []
    return {
        "session_id": session_id,
        "timestamp_source": "exact" if entries else "estimated",
        "timestamps": entries,
    }


@router.get("/api/spx/0dte/replay/snapshot")
def get_replay_snapshot(
    session_id: str,
    at: str | None = None,
    source_snapshot_id: str | None = None,
) -> dict:
    imported_snapshot = _imported_replay_snapshot(session_id, at, source_snapshot_id)
    if imported_snapshot is not None:
        return imported_snapshot

    persisted_snapshot = _persisted_replay_snapshot(session_id, at)
    if persisted_snapshot is not None:
        return persisted_snapshot

    snapshots = seed_replay_snapshots()
    if session_id != snapshots[0]["session_id"]:
        return {**snapshots[-1], "coverage_status": "empty", "rows": []}
    return nearest_replay_snapshot(snapshots, at)


def replay_stream_snapshots(
    session_id: str,
    at: str | None = None,
    source_snapshot_id: str | None = None,
) -> list[dict[str, Any]]:
    imported_snapshots = _imported_replay_stream_snapshots(session_id, at, source_snapshot_id)
    if imported_snapshots is not None:
        return imported_snapshots

    persisted_snapshots = _persisted_replay_snapshots(session_id, at)
    if persisted_snapshots:
        return persisted_snapshots

    snapshots = seed_replay_snapshots()
    if session_id == snapshots[0]["session_id"]:
        return snapshots_at_or_after(snapshots, at)

    return [{**snapshots[-1], "coverage_status": "empty", "rows": []}]


def _completed_imported_replay_sessions() -> list[dict[str, Any]]:
    try:
        return get_replay_import_repository().list_completed_sessions()
    except Exception as exc:
        raise _imported_replay_unavailable() from exc


def _is_completed_imported_session(session_id: str) -> bool:
    try:
        return get_replay_import_repository().is_completed_public_session(session_id)
    except Exception as exc:
        raise _imported_replay_unavailable() from exc


def _imported_replay_timestamps(session_id: str) -> list[dict[str, Any]]:
    try:
        return get_replay_import_repository().timestamps(session_id)
    except Exception as exc:
        raise _imported_replay_unavailable() from exc


def _imported_replay_snapshot(
    session_id: str,
    at: str | None,
    source_snapshot_id: str | None,
) -> dict[str, Any] | None:
    if not _is_completed_imported_session(session_id):
        return None

    if source_snapshot_id is not None:
        try:
            snapshot = get_replay_import_repository().snapshot_by_source_id(session_id, source_snapshot_id)
        except Exception as exc:
            raise _imported_replay_unavailable() from exc
        if snapshot is None:
            return _empty_replay_snapshot()
        return build_imported_analytics_snapshot(snapshot)

    try:
        snapshot = get_replay_import_repository().nearest_snapshot(session_id, at)
    except Exception as exc:
        raise _imported_replay_unavailable() from exc
    if snapshot is None:
        return _empty_replay_snapshot()
    return build_imported_analytics_snapshot(snapshot)


def _imported_replay_stream_snapshots(
    session_id: str,
    at: str | None,
    source_snapshot_id: str | None,
) -> list[dict[str, Any]] | None:
    if not _is_completed_imported_session(session_id):
        return None

    try:
        snapshots = get_replay_import_repository().stream_snapshots(session_id, at, source_snapshot_id)
    except Exception as exc:
        raise _imported_replay_unavailable() from exc
    return [build_imported_analytics_snapshot(snapshot) for snapshot in snapshots]


def _imported_replay_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail=IMPORTED_REPLAY_UNAVAILABLE_DETAIL)


def _persisted_replay_sessions() -> list[dict[str, Any]]:
    try:
        return get_replay_repository().list_sessions()
    except Exception:
        return []


def _persisted_replay_snapshot(session_id: str, at: str | None) -> dict[str, Any] | None:
    try:
        return get_replay_repository().nearest_snapshot(session_id, at)
    except Exception:
        snapshots = seed_replay_snapshots()
        if session_id == snapshots[0]["session_id"]:
            return None
        raise HTTPException(status_code=503, detail="Replay persistence unavailable") from None


def _persisted_replay_snapshots(session_id: str, at: str | None) -> list[dict[str, Any]]:
    try:
        return get_replay_repository().replay_snapshots(session_id, at)
    except Exception:
        snapshots = seed_replay_snapshots()
        if session_id == snapshots[0]["session_id"]:
            return []
        raise HTTPException(status_code=503, detail="Replay persistence unavailable") from None


def _empty_replay_snapshot() -> dict[str, Any]:
    return {**seed_replay_snapshots()[-1], "coverage_status": "empty", "rows": []}


def seed_replay_snapshots() -> list[dict[str, Any]]:
    base_snapshot = load_json_fixture("analytics-snapshot.seed.json")
    snapshots = []

    for index, timestamp in enumerate(REPLAY_TIMES):
        step_from_latest = index - (len(REPLAY_TIMES) - 1)
        snapshot = deepcopy(base_snapshot)
        spot_shift = step_from_latest * 2.5
        volatility_shift = step_from_latest * 0.0004
        gamma_scale = 1 + step_from_latest * 0.03

        snapshot["mode"] = "replay"
        snapshot["snapshot_time"] = timestamp
        snapshot["spot"] = round(base_snapshot["spot"] + spot_shift, 2)
        snapshot["forward"] = round(base_snapshot["forward"] + spot_shift, 2)
        snapshot["freshness_ms"] = base_snapshot["freshness_ms"] + (len(REPLAY_TIMES) - 1 - index) * 200

        for row in snapshot["rows"]:
            _shift_optional_number(row, "custom_iv", volatility_shift, 6)
            _scale_optional_number(row, "custom_gamma", gamma_scale, 8)
            _scale_optional_number(row, "custom_vanna", gamma_scale, 8)

            if row["custom_iv"] is not None and row["ibkr_iv"] is not None:
                row["iv_diff"] = round(row["custom_iv"] - row["ibkr_iv"], 6)
            if row["custom_gamma"] is not None and row["ibkr_gamma"] is not None:
                row["gamma_diff"] = round(row["custom_gamma"] - row["ibkr_gamma"], 8)

        snapshots.append(snapshot)

    return snapshots


def nearest_replay_snapshot(snapshots: list[dict[str, Any]], at: str | None) -> dict[str, Any]:
    if not at:
        return snapshots[-1]

    target_time = _parse_replay_time(at)
    if target_time is None:
        return snapshots[-1]

    return min(
        snapshots,
        key=lambda snapshot: abs((_parse_replay_time(snapshot["snapshot_time"]) - target_time).total_seconds()),
    )


def snapshots_at_or_after(snapshots: list[dict[str, Any]], at: str | None) -> list[dict[str, Any]]:
    if not at:
        return snapshots

    target_time = _parse_replay_time(at)
    if target_time is None:
        return snapshots

    return [
        snapshot
        for snapshot in snapshots
        if _parse_replay_time(snapshot["snapshot_time"]) >= target_time
    ]


def _parse_replay_time(value: str) -> datetime | None:
    try:
        parsed_time = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed_time if parsed_time.tzinfo is not None else parsed_time.replace(tzinfo=UTC)


def _shift_optional_number(row: dict[str, Any], key: str, shift: float, digits: int) -> None:
    if row[key] is not None:
        row[key] = round(row[key] + shift, digits)


def _scale_optional_number(row: dict[str, Any], key: str, scale: float, digits: int) -> None:
    if row[key] is not None:
        row[key] = round(row[key] * scale, digits)
