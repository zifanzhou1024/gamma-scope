from __future__ import annotations

from collections.abc import Mapping
from math import exp, isfinite, log, sqrt
from typing import Any

from gammascope_api.experimental.iv_methods import black76_price, normal_cdf
from gammascope_api.experimental.models import diagnostic, optional_float, panel


def probability_panel(iv_panel: dict[str, Any], *, forward: float, tau: float, rate: float) -> dict[str, Any]:
    if not _positive_finite(forward) or not _positive_finite(tau):
        return _empty_probability_panel("Forward and time to expiry must be positive.")
    points = _fit_points(iv_panel)
    if len(points) < 2:
        return _empty_probability_panel("A fitted smile is required.")
    levels = []
    for point in points:
        strike = point["x"]
        sigma = point["y"]
        d2 = (log(forward / strike) - 0.5 * sigma * sigma * tau) / (sigma * sqrt(tau))
        close_above = normal_cdf(d2)
        levels.append({"strike": strike, "closeAbove": close_above, "closeBelow": None if close_above is None else 1 - close_above})
    return panel(
        "preview",
        "Risk-neutral probabilities",
        [diagnostic("risk_neutral", "Probabilities are risk-neutral, not real-world.", "info")],
        levels=levels,
    )


def terminal_distribution_panel(iv_panel: dict[str, Any], *, forward: float, tau: float, rate: float) -> dict[str, Any]:
    if not _positive_finite(forward) or not _positive_finite(tau) or not isfinite(rate):
        return _empty_terminal_distribution_panel("Forward and time to expiry must be positive.")
    points = _fit_points(iv_panel)
    if len(points) < 3:
        return _empty_terminal_distribution_panel("A fitted smile with at least three points is required.")
    calls = [
        black76_price(forward=forward, strike=point["x"], tau=tau, rate=rate, sigma=point["y"], right="call")
        for point in points
    ]
    strikes = [point["x"] for point in points]
    density = []
    for index in range(1, len(points) - 1):
        left_width = strikes[index] - strikes[index - 1]
        right_width = strikes[index + 1] - strikes[index]
        if left_width <= 0 or right_width <= 0:
            return _empty_terminal_distribution_panel("Fitted smile strikes must be strictly increasing.")
        curvature = 2 / (left_width + right_width) * (
            (calls[index + 1] - calls[index]) / right_width - (calls[index] - calls[index - 1]) / left_width
        )
        density.append({"x": strikes[index], "y": max(0.0, curvature * exp(rate * tau))})
    if not density:
        return _empty_terminal_distribution_panel("Density could not be estimated.")
    highest = max(density, key=lambda point: point["y"] or 0)
    probabilities = probability_panel(iv_panel, forward=forward, tau=tau, rate=rate)["levels"]
    lower68, upper68 = _range_from_probabilities(probabilities, 0.16, 0.84)
    lower95, upper95 = _range_from_probabilities(probabilities, 0.025, 0.975)
    left_tail = next((level["closeBelow"] for level in probabilities if level["strike"] == lower95), None)
    right_tail = next((level["closeAbove"] for level in probabilities if level["strike"] == upper95), None)
    return panel(
        "preview",
        "Terminal distribution",
        [],
        density=density,
        highestDensityZone=f"{highest['x']:.0f}",
        range68=_range_label(lower68, upper68),
        range95=_range_label(lower95, upper95),
        leftTailProbability=left_tail,
        rightTailProbability=right_tail,
    )


def skew_tail_panel(iv_panel: dict[str, Any], *, forward: float) -> dict[str, Any]:
    if not _positive_finite(forward):
        return _empty_skew_tail_panel("Forward must be positive.")
    points = _fit_points(iv_panel)
    if len(points) < 3:
        return _empty_skew_tail_panel("A fitted smile is required.")
    atm = min(points, key=lambda point: abs(float(point["x"]) - forward))
    left = points[0]
    right = points[-1]
    atm_iv = max(float(atm["y"]), 1e-9)
    left_richness = float(left["y"]) / atm_iv
    right_richness = float(right["y"]) / atm_iv
    if left_richness - right_richness > 0.05:
        bias = "Left-tail rich"
    elif right_richness - left_richness > 0.05:
        bias = "Right-tail rich"
    else:
        bias = "Balanced tails"
    return panel(
        "preview",
        "Skew and tail asymmetry",
        [],
        tailBias=bias,
        leftTailRichness=left_richness,
        rightTailRichness=right_richness,
    )


def _fit_points(iv_panel: dict[str, Any]) -> list[dict[str, float]]:
    methods = iv_panel.get("methods", []) if isinstance(iv_panel, Mapping) else []
    if not isinstance(methods, list):
        return []
    for method in methods:
        if not isinstance(method, Mapping):
            continue
        if method.get("key") == "spline_fit":
            return _clean_fit_points(method.get("points", []))
    return []


def _range_from_probabilities(levels: list[dict[str, Any]], lower_tail: float, upper_tail: float) -> tuple[float | None, float | None]:
    lower = min(levels, key=lambda level: abs((level.get("closeBelow") or 0) - lower_tail), default={}).get("strike")
    upper = min(levels, key=lambda level: abs((level.get("closeBelow") or 0) - upper_tail), default={}).get("strike")
    return lower, upper


def _range_label(lower: float | None, upper: float | None) -> str | None:
    if lower is None or upper is None:
        return None
    return f"{lower:.0f}-{upper:.0f}"


def _clean_fit_points(points: list[dict[str, Any]]) -> list[dict[str, float]]:
    if not isinstance(points, list):
        return []
    by_strike: dict[float, float] = {}
    for point in points:
        if not isinstance(point, Mapping):
            continue
        strike = optional_float(point.get("x"))
        sigma = optional_float(point.get("y"))
        if strike is None or sigma is None or strike <= 0 or sigma <= 0:
            continue
        by_strike[strike] = sigma
    return [{"x": strike, "y": by_strike[strike]} for strike in sorted(by_strike)]


def _empty_probability_panel(message: str) -> dict[str, Any]:
    return panel("insufficient_data", "Risk-neutral probabilities", [diagnostic("missing_fit", message, "warning")], levels=[])


def _empty_terminal_distribution_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Terminal distribution",
        [diagnostic("missing_fit", message, "warning")],
        density=[],
        highestDensityZone=None,
        range68=None,
        range95=None,
        leftTailProbability=None,
        rightTailProbability=None,
    )


def _empty_skew_tail_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Skew and tail asymmetry",
        [diagnostic("missing_fit", message, "warning")],
        tailBias=None,
        leftTailRichness=None,
        rightTailRichness=None,
    )


def _positive_finite(value: float) -> bool:
    return isfinite(value) and value > 0
