from __future__ import annotations

from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, HTTPException, Header, Query

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.heatmap.dependencies import get_heatmap_repository
from gammascope_api.heatmap.service import build_heatmap_payload
from gammascope_api.ingestion.live_snapshot_service import (
    MOOMOO_LIVE_REPLAY_SESSION_IDS,
    HeatmapSymbol,
    get_live_snapshot_service,
)
from gammascope_api.replay.dependencies import get_replay_repository


router = APIRouter()
HeatmapMetric = Literal["gex", "vex"]


@router.get("/api/spx/0dte/heatmap/latest")
def get_latest_heatmap(
    metric: HeatmapMetric = Query(default="gex"),
    symbol: HeatmapSymbol = Query(default="SPX"),
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = get_live_snapshot_service().symbol_snapshot(symbol)
        if live_snapshot is not None:
            return build_heatmap_payload(live_snapshot, metric, get_heatmap_repository())
        replay_snapshot = _latest_moomoo_live_replay_snapshot(symbol)
        if replay_snapshot is not None:
            return build_heatmap_payload(replay_snapshot, metric, get_heatmap_repository())

    if symbol != "SPX":
        raise HTTPException(status_code=404, detail=f"No heatmap snapshot is available for {symbol}")
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return build_heatmap_payload(snapshot, metric, get_heatmap_repository(), persist=False)


def _latest_moomoo_live_replay_snapshot(symbol: HeatmapSymbol) -> dict | None:
    try:
        snapshot = get_replay_repository().nearest_snapshot(MOOMOO_LIVE_REPLAY_SESSION_IDS[symbol])
    except Exception:
        return None
    if snapshot is None:
        return None

    live_snapshot = deepcopy(snapshot)
    live_snapshot["mode"] = "live"
    return live_snapshot
