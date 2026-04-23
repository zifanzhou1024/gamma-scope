from typing import Any

from fastapi import APIRouter

from gammascope_api.analytics.scenario import create_scenario_snapshot
from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.post("/api/spx/0dte/scenario")
def create_scenario(payload: dict[str, Any]) -> dict:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return create_scenario_snapshot(snapshot, payload)
