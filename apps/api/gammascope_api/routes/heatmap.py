from __future__ import annotations

from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, HTTPException, Header, Query

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.heatmap.dependencies import get_heatmap_repository
from gammascope_api.heatmap.service import build_heatmap_payload
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot
from gammascope_api.replay.dependencies import get_replay_repository


router = APIRouter()
HeatmapMetric = Literal["gex", "vex"]
HeatmapSymbol = Literal["SPX", "SPY", "QQQ", "NDX", "IWM"]
MOOMOO_LIVE_REPLAY_SESSION_IDS = {
    "SPX": "moomoo-spx-0dte-live",
    "SPY": "moomoo-spy-0dte-live",
    "QQQ": "moomoo-qqq-0dte-live",
    "NDX": "moomoo-ndx-0dte-live",
    "IWM": "moomoo-iwm-0dte-live",
}


@router.get("/api/spx/0dte/heatmap/latest")
def get_latest_heatmap(
    metric: HeatmapMetric = Query(default="gex"),
    symbol: HeatmapSymbol = Query(default="SPX"),
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = build_live_snapshot(
            cached_or_memory_collector_state(),
            session_id=MOOMOO_LIVE_REPLAY_SESSION_IDS[symbol],
        )
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
