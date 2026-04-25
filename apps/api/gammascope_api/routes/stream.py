import asyncio
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot


router = APIRouter()

STREAM_INTERVAL_SECONDS = 1.0


@router.websocket("/ws/spx/0dte")
async def stream_spx_0dte(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(_current_snapshot())
            await asyncio.sleep(STREAM_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return


def _current_snapshot() -> dict[str, Any]:
    live_snapshot = build_live_snapshot(collector_state)
    if live_snapshot is not None:
        return live_snapshot
    return load_json_fixture("analytics-snapshot.seed.json")
