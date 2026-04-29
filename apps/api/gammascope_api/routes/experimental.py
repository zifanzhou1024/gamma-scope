from __future__ import annotations

from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.experimental.service import build_experimental_payload
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot
from gammascope_api.routes import replay as replay_routes


router = APIRouter()


@router.get("/api/spx/0dte/experimental/latest")
def get_latest_experimental(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = build_live_snapshot(cached_or_memory_collector_state())
        if live_snapshot is not None:
            return build_experimental_payload(live_snapshot, "latest")
    return load_json_fixture("experimental-analytics.seed.json")


@router.get("/api/spx/0dte/experimental/replay/snapshot")
def get_replay_experimental_snapshot(
    session_id: str,
    at: str | None = None,
    source_snapshot_id: str | None = None,
) -> dict:
    snapshot = replay_routes.get_replay_snapshot(
        session_id=session_id,
        at=at,
        source_snapshot_id=source_snapshot_id,
    )
    return build_experimental_payload(snapshot, "replay")
