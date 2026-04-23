from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/snapshot/latest")
def get_latest_snapshot() -> dict:
    return load_json_fixture("analytics-snapshot.seed.json")
