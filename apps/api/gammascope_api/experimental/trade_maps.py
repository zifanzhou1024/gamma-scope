from __future__ import annotations

from bisect import bisect_left
from collections.abc import Mapping
from math import isfinite
from typing import Any

from gammascope_api.experimental.iv_methods import black76_price
from gammascope_api.experimental.models import diagnostic, optional_float, panel


def move_needed_panel(rows: Any, *, spot: float, expected_move: float | None) -> dict[str, Any]:
    out = []
    for row in _iter_rows(rows):
        mid = optional_float(row.get("mid"))
        strike = optional_float(row.get("strike"))
        side = _option_side(row)
        if mid is None or strike is None or strike <= 0 or side is None:
            continue
        if side == "call":
            breakeven = strike + mid
            move_needed = max(0.0, breakeven - spot)
        else:
            breakeven = strike - mid
            move_needed = max(0.0, spot - breakeven)
        ratio = move_needed / expected_move if expected_move and expected_move > 0 else None
        out.append(
            {
                "strike": strike,
                "side": side,
                "breakeven": breakeven,
                "moveNeeded": move_needed,
                "expectedMoveRatio": ratio,
                "label": _ratio_label(ratio),
            }
        )
    return panel("ok" if out else "insufficient_data", "Move-needed map", [], rows=out)


def decay_pressure_panel(rows: Any, *, minutes_to_expiry: float) -> dict[str, Any]:
    if not _positive_finite(minutes_to_expiry):
        return panel(
            "insufficient_data",
            "Time-decay pressure",
            [diagnostic("invalid_time", "Minutes to expiry must be positive.", "warning")],
            rows=[],
        )
    out = []
    for row in _iter_rows(rows):
        mid = optional_float(row.get("mid"))
        strike = optional_float(row.get("strike"))
        side = _option_side(row)
        if mid is None or strike is None or strike <= 0 or side is None:
            continue
        out.append({"strike": strike, "side": side, "premium": mid, "pointsPerMinute": mid / minutes_to_expiry})
    return panel(
        "preview" if out else "insufficient_data",
        "Time-decay pressure",
        [diagnostic("static_decay", "Static pressure assumes no spot or IV change.", "info")],
        rows=out,
    )


def rich_cheap_panel(rows: Any, *, iv_panel: dict[str, Any], forward: float, tau: float, rate: float) -> dict[str, Any]:
    if not _positive_finite(forward) or not _positive_finite(tau) or not isfinite(rate):
        return panel("insufficient_data", "Rich/cheap residuals", [diagnostic("invalid_model_inputs", "Forward and time to expiry must be positive.", "warning")], rows=[])
    fit_points = _fit_points(iv_panel)
    out = []
    for row in _iter_rows(rows):
        mid = optional_float(row.get("mid"))
        strike = optional_float(row.get("strike"))
        side = _option_side(row)
        if mid is None or strike is None or strike <= 0 or side is None:
            continue
        sigma = _interpolated_sigma(fit_points, strike)
        if sigma is None:
            continue
        fitted_fair = black76_price(forward=forward, strike=strike, tau=tau, rate=rate, sigma=sigma, right=side)
        residual = mid - fitted_fair
        out.append(
            {
                "strike": strike,
                "side": side,
                "actualMid": mid,
                "fittedFair": fitted_fair,
                "residual": residual,
                "label": _residual_label(residual),
            }
        )
    return panel("preview" if out else "insufficient_data", "Rich/cheap residuals", [], rows=out)


def _ratio_label(ratio: float | None) -> str:
    if ratio is None:
        return "Expected move unavailable"
    if ratio < 0.5:
        return "Breakeven close"
    if ratio <= 1.0:
        return "Within expected move"
    if ratio <= 1.5:
        return "Needs above-normal move"
    return "Lottery-like"


def _residual_label(residual: float) -> str:
    if residual > 0.1:
        return "Rich"
    if residual < -0.1:
        return "Cheap"
    return "Inline"


def _iter_rows(rows: Any) -> list[Mapping[str, Any]]:
    if not isinstance(rows, (list, tuple)):
        return []
    return [row for row in rows if isinstance(row, Mapping)]


def _fit_points(iv_panel: dict[str, Any]) -> list[dict[str, float]]:
    methods = iv_panel.get("methods", []) if isinstance(iv_panel, Mapping) else []
    if not isinstance(methods, list):
        return []
    for method in methods:
        if not isinstance(method, Mapping):
            continue
        if method.get("key") == "spline_fit":
            by_strike = {}
            points = method.get("points", [])
            if not isinstance(points, list):
                return []
            for point in points:
                if not isinstance(point, Mapping):
                    continue
                strike = optional_float(point.get("x"))
                sigma = optional_float(point.get("y"))
                if strike is not None and sigma is not None and strike > 0 and sigma > 0:
                    by_strike[strike] = sigma
            return [{"x": strike, "y": by_strike[strike]} for strike in sorted(by_strike)]
    return []


def _interpolated_sigma(points: list[dict[str, float]], strike: float) -> float | None:
    if not points:
        return None
    strikes = [point["x"] for point in points]
    index = bisect_left(strikes, strike)
    if index < len(points) and abs(points[index]["x"] - strike) <= 1e-9:
        return points[index]["y"]
    if index == 0 or index >= len(points):
        return None
    left = points[index - 1]
    right = points[index]
    width = right["x"] - left["x"]
    if width <= 0:
        return None
    weight = (strike - left["x"]) / width
    return left["y"] + weight * (right["y"] - left["y"])


def _option_side(row: Mapping[str, Any]) -> str | None:
    side = row.get("right")
    if side == "call" or side == "put":
        return side
    return None


def _positive_finite(value: float) -> bool:
    return isfinite(value) and value > 0
