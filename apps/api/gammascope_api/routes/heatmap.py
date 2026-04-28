from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, Query

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.heatmap.dependencies import get_heatmap_repository
from gammascope_api.heatmap.service import build_heatmap_payload
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot


router = APIRouter()
HeatmapMetric = Literal["gex", "vex"]


@router.get("/api/spx/0dte/heatmap/latest")
def get_latest_heatmap(
    metric: HeatmapMetric = Query(default="gex"),
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = build_live_snapshot(cached_or_memory_collector_state())
        if live_snapshot is not None:
            return build_heatmap_payload(live_snapshot, metric, get_heatmap_repository())

    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return build_heatmap_payload(snapshot, metric, get_heatmap_repository(), persist=False)
