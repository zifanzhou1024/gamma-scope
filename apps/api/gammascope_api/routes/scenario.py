from copy import deepcopy
from typing import Any

from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.post("/api/spx/0dte/scenario")
def create_scenario(payload: dict[str, Any]) -> dict:
    snapshot = deepcopy(load_json_fixture("analytics-snapshot.seed.json"))
    snapshot["mode"] = "scenario"
    snapshot["scenario_params"] = {
        "spot_shift_points": payload.get("spot_shift_points", 0),
        "vol_shift_points": payload.get("vol_shift_points", 0),
        "time_shift_minutes": payload.get("time_shift_minutes", 0)
    }
    return snapshot
