from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot


router = APIRouter()


@router.get("/api/spx/0dte/snapshot/latest")
def get_latest_snapshot() -> dict:
    live_snapshot = build_live_snapshot(collector_state)
    if live_snapshot is not None:
        return live_snapshot
    return load_json_fixture("analytics-snapshot.seed.json")
