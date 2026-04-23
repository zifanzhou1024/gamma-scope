from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/replay/sessions")
def list_replay_sessions() -> list[dict]:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return [
        {
            "session_id": snapshot["session_id"],
            "symbol": snapshot["symbol"],
            "expiry": snapshot["expiry"],
            "start_time": snapshot["snapshot_time"],
            "end_time": snapshot["snapshot_time"],
            "snapshot_count": 1
        }
    ]


@router.get("/api/spx/0dte/replay/snapshot")
def get_replay_snapshot(session_id: str, at: str | None = None) -> dict:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    if session_id != snapshot["session_id"]:
        return {**snapshot, "coverage_status": "empty", "rows": []}
    return snapshot
