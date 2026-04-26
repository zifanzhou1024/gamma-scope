from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state


router = APIRouter()


@router.get("/api/spx/0dte/status")
def get_status() -> dict:
    latest_health = cached_or_memory_collector_state().latest_health()
    if latest_health is not None:
        return latest_health
    return load_json_fixture("collector-health.seed.json")
