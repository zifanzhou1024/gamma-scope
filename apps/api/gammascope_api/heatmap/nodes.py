from __future__ import annotations

from math import isfinite
from typing import Any, Literal, TypedDict

from gammascope_api.heatmap.normalization import percentile


HeatmapMetric = Literal["gex", "vex"]
NodeValue = dict[str, float] | None
SUPPORTED_METRICS = {"gex", "vex"}


class HeatmapNodes(TypedDict):
    king: NodeValue
    positiveKing: NodeValue
    negativeKing: NodeValue
    aboveWall: NodeValue
    belowWall: NodeValue


EMPTY_NODES: HeatmapNodes = {
    "king": None,
    "positiveKing": None,
    "negativeKing": None,
    "aboveWall": None,
    "belowWall": None,
}


def derive_nodes(rows: list[Any], spot: float, metric: HeatmapMetric) -> HeatmapNodes:
    _validate_metric(metric)
    if not rows:
        return EMPTY_NODES.copy()

    ranked_rows = _ranked_rows(rows, metric)
    if not ranked_rows:
        return EMPTY_NODES.copy()

    threshold = percentile([abs(value) for _, value in ranked_rows], 80)

    king = max(ranked_rows, key=lambda row: abs(row[1]))
    positive = max((row for row in ranked_rows if row[1] > 0), key=lambda row: row[1], default=None)
    negative = min((row for row in ranked_rows if row[1] < 0), key=lambda row: row[1], default=None)
    above = min(
        (row for row in ranked_rows if row[0] > spot and abs(row[1]) >= threshold),
        key=lambda row: row[0],
        default=None,
    )
    below = max(
        (row for row in ranked_rows if row[0] < spot and abs(row[1]) >= threshold),
        key=lambda row: row[0],
        default=None,
    )

    return {
        "king": _node(king),
        "positiveKing": _node(positive),
        "negativeKing": _node(negative),
        "aboveWall": _node(above),
        "belowWall": _node(below),
    }


def _node(row: tuple[float, float] | None) -> NodeValue:
    if row is None:
        return None
    strike, value = row
    return {"strike": strike, "value": value}


def _ranked_rows(rows: list[Any], metric: HeatmapMetric) -> list[tuple[float, float]]:
    ranked_rows = []
    for row in rows:
        strike = _strike(row)
        value = _metric_value(row, metric)
        if not isfinite(strike) or not isfinite(value) or value == 0:
            continue
        ranked_rows.append((strike, value))
    return ranked_rows


def _validate_metric(metric: str) -> None:
    if metric not in SUPPORTED_METRICS:
        raise ValueError(f"unsupported heatmap metric: {metric}")


def _metric_value(row: Any, metric: str) -> float:
    value = _row_value(row, metric)
    return float(value)


def _strike(row: Any) -> float:
    return float(_row_value(row, "strike"))


def _row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row[key]
    return getattr(row, key)
