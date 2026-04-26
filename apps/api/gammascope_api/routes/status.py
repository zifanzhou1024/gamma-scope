from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state


router = APIRouter()


@router.get("/api/spx/0dte/status")
def get_status(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        latest_health = cached_or_memory_collector_state().latest_health()
        if latest_health is not None:
            return latest_health
    return load_json_fixture("collector-health.seed.json")
