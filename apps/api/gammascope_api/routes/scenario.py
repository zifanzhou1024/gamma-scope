from typing import Any

from fastapi import APIRouter

from gammascope_api.analytics.scenario import create_scenario_snapshot
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot


router = APIRouter()


@router.post("/api/spx/0dte/scenario")
def create_scenario(payload: dict[str, Any]) -> dict:
    live_snapshot = build_live_snapshot(collector_state)
    if live_snapshot is not None and live_snapshot["session_id"] == payload.get("session_id"):
        snapshot = live_snapshot
    else:
        snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return create_scenario_snapshot(snapshot, payload)
