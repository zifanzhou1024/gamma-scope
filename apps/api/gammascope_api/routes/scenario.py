from typing import Any

from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.analytics.scenario import create_scenario_snapshot
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.live_snapshot_service import get_live_snapshot_service


router = APIRouter()


@router.post("/api/spx/0dte/scenario")
def create_scenario(
    payload: dict[str, Any],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = get_live_snapshot_service().dashboard_snapshot()
        if live_snapshot is not None and live_snapshot["session_id"] == payload.get("session_id"):
            return create_scenario_snapshot(live_snapshot, payload)

    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return create_scenario_snapshot(snapshot, payload)
