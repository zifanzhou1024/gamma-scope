from __future__ import annotations

from typing import Any

from gammascope_api.experimental.iv_methods import black76_price
from gammascope_api.experimental.models import diagnostic, optional_float, panel


def move_needed_panel(rows: list[dict[str, Any]], *, spot: float, expected_move: float | None) -> dict[str, Any]:
    out = []
    for row in rows:
        mid = optional_float(row.get("mid"))
        if mid is None:
            continue
        strike = float(row["strike"])
        side = str(row["right"])
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


def decay_pressure_panel(rows: list[dict[str, Any]], *, minutes_to_expiry: float) -> dict[str, Any]:
    out = []
    minutes = max(minutes_to_expiry, 1e-9)
    for row in rows:
        mid = optional_float(row.get("mid"))
        if mid is None:
            continue
        out.append({"strike": float(row["strike"]), "side": row["right"], "premium": mid, "pointsPerMinute": mid / minutes})
    return panel(
        "preview" if out else "insufficient_data",
        "Time-decay pressure",
        [diagnostic("static_decay", "Static pressure assumes no spot or IV change.", "info")],
        rows=out,
    )


def rich_cheap_panel(rows: list[dict[str, Any]], *, iv_panel: dict[str, Any], forward: float, tau: float, rate: float) -> dict[str, Any]:
    fit_by_strike = _fit_by_strike(iv_panel)
    out = []
    for row in rows:
        mid = optional_float(row.get("mid"))
        sigma = fit_by_strike.get(float(row["strike"]))
        if mid is None or sigma is None:
            continue
        side = row["right"]
        fitted_fair = black76_price(forward=forward, strike=float(row["strike"]), tau=tau, rate=rate, sigma=sigma, right=side)
        residual = mid - fitted_fair
        out.append(
            {
                "strike": float(row["strike"]),
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


def _fit_by_strike(iv_panel: dict[str, Any]) -> dict[float, float]:
    for method in iv_panel.get("methods", []):
        if method.get("key") == "spline_fit":
            return {float(point["x"]): float(point["y"]) for point in method.get("points", []) if point.get("y") is not None}
    return {}
