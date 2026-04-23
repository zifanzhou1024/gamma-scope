from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/status")
def get_status() -> dict:
    return load_json_fixture("collector-health.seed.json")
