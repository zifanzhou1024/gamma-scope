from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite, sqrt
from typing import Any
from zoneinfo import ZoneInfo


NEW_YORK_TZ = ZoneInfo("America/New_York")
SUPPORTED_METRICS = {"gex", "vex"}


def percentile(values: list[float], pct: float) -> float:
    finite_values = [value for value in values if isfinite(value)]
    if not finite_values:
        return 0

    ordered = sorted(finite_values)
    if len(ordered) == 1:
        return ordered[0]

    pct = max(0, min(100, pct))
    rank = (len(ordered) - 1) * pct / 100
    lower_index = int(rank)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = rank - lower_index

    return ordered[lower_index] + (ordered[upper_index] - ordered[lower_index]) * fraction


def color_norms_by_strike(rows: list[Any], metric: str) -> dict[float, float]:
    _validate_metric(metric)

    strike_values = _finite_strike_values(rows, metric)
    values = [value for _, value in strike_values]
    abs_values = [abs(value) for value in values]
    scale_base = percentile(abs_values, 95)

    if scale_base <= 0:
        return {strike: 0 for strike, _ in strike_values}

    return {
        strike: min(1, sqrt(abs(value) / scale_base))
        for strike, value in strike_values
    }


def market_date_new_york(value: datetime | str) -> str:
    return _to_datetime(value).astimezone(NEW_YORK_TZ).date().isoformat()


def five_minute_bucket_start(value: datetime | str) -> str:
    utc_value = _to_datetime(value).astimezone(timezone.utc)
    floored_minute = utc_value.minute - (utc_value.minute % 5)
    bucket = utc_value.replace(minute=floored_minute, second=0, microsecond=0)
    return bucket.isoformat().replace("+00:00", "Z")


def _to_datetime(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _metric_value(row: Any, metric: str) -> float:
    value = _row_value(row, metric)
    return float(value)


def _strike(row: Any) -> float:
    return float(_row_value(row, "strike"))


def _finite_strike_values(rows: list[Any], metric: str) -> list[tuple[float, float]]:
    strike_values = []
    for row in rows:
        strike = _strike(row)
        value = _metric_value(row, metric)
        if not isfinite(strike) or not isfinite(value):
            continue
        strike_values.append((strike, value))
    return strike_values


def _validate_metric(metric: str) -> None:
    if metric not in SUPPORTED_METRICS:
        raise ValueError(f"unsupported heatmap metric: {metric}")


def _row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row[key]
    return getattr(row, key)
