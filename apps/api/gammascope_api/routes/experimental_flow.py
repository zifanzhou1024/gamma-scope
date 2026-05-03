from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.service import (
    build_latest_experimental_flow_payload,
    build_replay_experimental_flow_payload,
    has_latest_payload_for_session,
    validate_experimental_flow_payload,
)
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.live_snapshot_service import MOOMOO_LIVE_REPLAY_SESSION_IDS, get_live_snapshot_service
from gammascope_api.routes.replay import replay_stream_snapshots


router = APIRouter()


@router.get("/api/spx/0dte/experimental-flow/latest", response_model=ExperimentalFlow)
def get_latest_experimental_flow(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = get_live_snapshot_service().dashboard_snapshot()
        if _is_spx_live_snapshot(live_snapshot):
            current_snapshot, previous_snapshot = _bootstrap_latest_snapshots(live_snapshot)
            return build_latest_experimental_flow_payload(
                current_snapshot,
                previous_snapshot=previous_snapshot,
            )
    return validate_experimental_flow_payload(load_json_fixture("experimental-flow.seed.json"))


@router.get("/api/spx/0dte/experimental-flow/replay", response_model=ExperimentalFlow)
def get_replay_experimental_flow(
    session_id: str,
    at: str | None = None,
    source_snapshot_id: str | None = None,
    horizon_minutes: int = 5,
) -> dict:
    try:
        snapshots = replay_stream_snapshots(session_id=session_id, at=at, source_snapshot_id=source_snapshot_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Replay persistence unavailable") from exc
    return build_replay_experimental_flow_payload(snapshots, horizon_minutes=horizon_minutes)


def _is_spx_live_snapshot(live_snapshot: dict | None) -> bool:
    if live_snapshot is None:
        return False
    return live_snapshot.get("symbol") == "SPX" and live_snapshot.get("session_id") == MOOMOO_LIVE_REPLAY_SESSION_IDS["SPX"]


def _bootstrap_latest_snapshots(live_snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    session_id = _text(live_snapshot.get("session_id"))
    current_time = _safe_parse_time(_text(live_snapshot.get("snapshot_time")))
    if session_id is None or current_time is None or has_latest_payload_for_session(session_id):
        return live_snapshot, None

    try:
        snapshots = replay_stream_snapshots(session_id=session_id)
    except Exception:
        return live_snapshot, None

    if _snapshot_has_rows(live_snapshot):
        return live_snapshot, _latest_non_empty_snapshot_before(snapshots, current_time)

    current_snapshot = _latest_non_empty_snapshot_before(snapshots, current_time, inclusive=True)
    if current_snapshot is None:
        return live_snapshot, None

    replay_current_time = _safe_parse_time(_text(current_snapshot.get("snapshot_time")))
    if replay_current_time is None:
        return current_snapshot, None
    return current_snapshot, _latest_non_empty_snapshot_before(snapshots, replay_current_time)


def _latest_non_empty_snapshot_before(
    snapshots: list[dict[str, Any]],
    cutoff: datetime,
    *,
    inclusive: bool = False,
) -> dict[str, Any] | None:
    candidates = [
        (snapshot_time, snapshot)
        for snapshot in snapshots
        if _snapshot_has_rows(snapshot)
        for snapshot_time in [_safe_parse_time(_text(snapshot.get("snapshot_time")))]
        if snapshot_time is not None and (snapshot_time < cutoff or (inclusive and snapshot_time <= cutoff))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def _snapshot_has_rows(snapshot: dict[str, Any]) -> bool:
    rows = snapshot.get("rows")
    return isinstance(rows, list) and len(rows) > 0


def _safe_parse_time(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
