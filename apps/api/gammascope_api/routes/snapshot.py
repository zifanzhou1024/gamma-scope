from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.live_snapshot_service import get_live_snapshot_service


router = APIRouter()


@router.get("/api/spx/0dte/snapshot/latest")
def get_latest_snapshot(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = get_live_snapshot_service().dashboard_snapshot()
        if live_snapshot is not None:
            return live_snapshot
    return load_json_fixture("analytics-snapshot.seed.json")
