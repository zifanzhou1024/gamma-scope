import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.live_snapshot_service import get_live_snapshot_service
from gammascope_api.routes.replay import replay_stream_snapshots, seed_replay_snapshots


router = APIRouter()

STREAM_INTERVAL_SECONDS = 2.0
MIN_REPLAY_INTERVAL_MS = 50
MAX_REPLAY_INTERVAL_MS = 2000
DEFAULT_REPLAY_INTERVAL_MS = 250


@router.websocket("/ws/spx/0dte")
async def stream_spx_0dte(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(_current_snapshot())
            await asyncio.sleep(STREAM_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return


@router.websocket("/ws/spx/0dte/replay")
async def stream_spx_0dte_replay(
    websocket: WebSocket,
    session_id: str = Query(...),
    at: str | None = None,
    source_snapshot_id: str | None = None,
    interval_ms: int = DEFAULT_REPLAY_INTERVAL_MS,
) -> None:
    await websocket.accept()
    interval_seconds = _replay_interval_seconds(interval_ms)
    try:
        if source_snapshot_id is None:
            snapshots = await asyncio.to_thread(replay_stream_snapshots, session_id, at)
        else:
            snapshots = await asyncio.to_thread(replay_stream_snapshots, session_id, at, source_snapshot_id)
    except HTTPException as exc:
        await websocket.close(code=1011, reason=str(exc.detail))
        return

    if not snapshots:
        snapshots = [_empty_replay_snapshot()]

    try:
        for index, snapshot in enumerate(snapshots):
            await websocket.send_json(snapshot)
            if index < len(snapshots) - 1:
                await asyncio.sleep(interval_seconds)
    except WebSocketDisconnect:
        return
    await websocket.close()


def _current_snapshot() -> dict[str, Any]:
    live_snapshot = get_live_snapshot_service().dashboard_snapshot()
    if live_snapshot is not None:
        return live_snapshot
    return load_json_fixture("analytics-snapshot.seed.json")


def _replay_interval_seconds(interval_ms: int) -> float:
    clamped_interval_ms = min(max(interval_ms, MIN_REPLAY_INTERVAL_MS), MAX_REPLAY_INTERVAL_MS)
    return clamped_interval_ms / 1000


def _empty_replay_snapshot() -> dict[str, Any]:
    return {**seed_replay_snapshots()[-1], "coverage_status": "empty", "rows": []}
