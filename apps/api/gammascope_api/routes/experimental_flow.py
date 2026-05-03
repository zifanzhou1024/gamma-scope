from __future__ import annotations

from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.service import (
    build_latest_experimental_flow_payload,
    validate_experimental_flow_payload,
)
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.live_snapshot_service import MOOMOO_LIVE_REPLAY_SESSION_IDS, get_live_snapshot_service


router = APIRouter()


@router.get("/api/spx/0dte/experimental-flow/latest", response_model=ExperimentalFlow)
def get_latest_experimental_flow(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = get_live_snapshot_service().dashboard_snapshot()
        if _is_spx_live_snapshot(live_snapshot):
            return build_latest_experimental_flow_payload(live_snapshot)
    return validate_experimental_flow_payload(load_json_fixture("experimental-flow.seed.json"))


def _is_spx_live_snapshot(live_snapshot: dict | None) -> bool:
    if live_snapshot is None:
        return False
    return live_snapshot.get("symbol") == "SPX" and live_snapshot.get("session_id") == MOOMOO_LIVE_REPLAY_SESSION_IDS["SPX"]
