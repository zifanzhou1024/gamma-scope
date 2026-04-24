from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state


router = APIRouter()


@router.get("/api/spx/0dte/status")
def get_status() -> dict:
    latest_health = collector_state.latest_health()
    if latest_health is not None:
        return latest_health
    return load_json_fixture("collector-health.seed.json")
