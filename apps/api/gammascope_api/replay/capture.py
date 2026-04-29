from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.ingestion.live_snapshot import build_live_snapshot
from gammascope_api.replay.dependencies import capture_interval_seconds, get_replay_repository
from gammascope_api.replay.repository import ReplayRepository

PERSISTENCE_FAILURE_COOLDOWN_SECONDS = 30
_persistence_unavailable_until: datetime | None = None


class ReplayCaptureRecorder:
    def __init__(self, repository: ReplayRepository, *, interval_seconds: int) -> None:
        self.repository = repository
        self.interval_seconds = interval_seconds

    def capture(self, snapshot: dict[str, Any] | None) -> dict[str, Any]:
        if snapshot is None:
            return {"captured": False, "reason": "snapshot_not_ready"}
        if snapshot.get("mode") != "live":
            return {"captured": False, "reason": "not_live"}
        if not snapshot.get("rows"):
            return {"captured": False, "reason": "empty_snapshot"}

        replay_snapshot = _replay_ready_snapshot(snapshot)
        session_id = str(replay_snapshot["session_id"])
        latest = self.repository.latest_snapshot_summary(session_id)

        if latest is None:
            summary = self.repository.insert_snapshot(replay_snapshot, source="ibkr")
            return {"captured": True, "action": "inserted", **summary}

        elapsed_seconds = (
            _parse_datetime(str(replay_snapshot["snapshot_time"])) - _parse_datetime(str(latest["snapshot_time"]))
        ).total_seconds()
        if elapsed_seconds < 0:
            return {"captured": False, "reason": "stale_snapshot"}
        if elapsed_seconds >= self.interval_seconds:
            summary = self.repository.insert_snapshot(replay_snapshot, source="ibkr")
            return {"captured": True, "action": "inserted", **summary}

        summary = self.repository.update_snapshot(int(latest["snapshot_id"]), replay_snapshot, source="ibkr")
        return {"captured": True, "action": "updated", **summary}


def capture_live_snapshot_from_state(state: CollectorState) -> dict[str, Any]:
    global _persistence_unavailable_until
    now = datetime.now(UTC)
    if _persistence_unavailable_until is not None and now < _persistence_unavailable_until:
        return {"captured": False, "reason": "persistence_unavailable_recently"}

    recorder = ReplayCaptureRecorder(get_replay_repository(), interval_seconds=capture_interval_seconds())
    try:
        snapshots = _live_snapshots_from_state(state)
        if not snapshots:
            return {"captured": False, "reason": "snapshot_not_ready"}

        captures = [recorder.capture(snapshot) for snapshot in snapshots]
        if len(captures) == 1:
            return captures[0]
        captured = [capture for capture in captures if capture.get("captured") is True]
        if captured:
            return {
                "captured": True,
                "captured_count": len(captured),
                "captures": captures,
            }
        return {
            "captured": False,
            "reason": str(captures[0].get("reason") or "snapshot_not_ready"),
            "captures": captures,
        }
    except Exception as exc:
        _persistence_unavailable_until = now + timedelta(seconds=PERSISTENCE_FAILURE_COOLDOWN_SECONDS)
        return {
            "captured": False,
            "reason": "persistence_unavailable",
            "message": str(exc),
        }


def reset_replay_capture_circuit() -> None:
    global _persistence_unavailable_until
    _persistence_unavailable_until = None


def _live_snapshots_from_state(state: CollectorState) -> list[dict[str, Any]]:
    session_ids = _live_session_ids(state)
    if not session_ids:
        snapshot = build_live_snapshot(state)
        return [] if snapshot is None else [snapshot]

    snapshots: list[dict[str, Any]] = []
    for session_id in session_ids:
        snapshot = build_live_snapshot(state, session_id=session_id)
        if snapshot is not None:
            snapshots.append(snapshot)
    return snapshots


def _live_session_ids(state: CollectorState) -> list[str]:
    return sorted(str(session_id) for session_id in state.snapshot().get("underlying_ticks", {}))


def _replay_ready_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    replay_snapshot = deepcopy(snapshot)
    replay_snapshot["mode"] = "replay"
    return replay_snapshot


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
