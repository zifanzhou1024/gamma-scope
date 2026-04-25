from typing import Any

from fastapi import APIRouter

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.replay.capture import capture_live_snapshot_from_state


router = APIRouter()


@router.post("/api/spx/0dte/collector/events")
def ingest_collector_event(payload: CollectorEvents) -> dict[str, Any]:
    event_type = collector_state.ingest(payload)
    replay_capture = capture_live_snapshot_from_state(collector_state)
    return {
        "accepted": True,
        "event_type": event_type,
        "state": collector_state.summary(),
        "replay_capture": replay_capture,
    }


@router.get("/api/spx/0dte/collector/state")
def get_collector_state() -> dict[str, Any]:
    return collector_state.summary()
