from __future__ import annotations

from math import erf, exp, isfinite, log, pi, sqrt
from typing import Any, Literal

import numpy as np
from scipy.interpolate import UnivariateSpline
from scipy.optimize import brentq

from gammascope_api.experimental.forward import time_to_expiry_years
from gammascope_api.experimental.models import diagnostic, optional_float, panel
from gammascope_api.experimental.quality import grouped_pairs, quote_flags

Right = Literal["call", "put"]
SIGMA_MIN = 0.0001
SIGMA_MAX = 8.5


def normal_cdf(value: float) -> float:
    return 0.5 * (1 + erf(value / sqrt(2)))


def black76_price(*, forward: float, strike: float, tau: float, rate: float, sigma: float, right: Right) -> float:
    if forward <= 0 or strike <= 0 or tau <= 0 or sigma <= 0:
        return 0.0
    df = exp(-rate * tau)
    vol_sqrt_t = sigma * sqrt(tau)
    if vol_sqrt_t <= 0:
        intrinsic = max(forward - strike, 0) if right == "call" else max(strike - forward, 0)
        return df * intrinsic
    d1 = (log(forward / strike) + 0.5 * sigma * sigma * tau) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    if right == "call":
        return df * (forward * normal_cdf(d1) - strike * normal_cdf(d2))
    return df * (strike * normal_cdf(-d2) - forward * normal_cdf(-d1))


def implied_vol_black76(*, price: float, forward: float, strike: float, tau: float, rate: float, right: Right) -> float | None:
    if price <= 0 or forward <= 0 or strike <= 0 or tau <= 0:
        return None
    df = exp(-rate * tau)
    intrinsic = df * (max(forward - strike, 0) if right == "call" else max(strike - forward, 0))
    if price < intrinsic - 1e-8:
        return None

    def objective(sigma: float) -> float:
        return black76_price(forward=forward, strike=strike, tau=tau, rate=rate, sigma=sigma, right=right) - price

    try:
        return float(brentq(objective, SIGMA_MIN, SIGMA_MAX, xtol=1e-8, maxiter=100))
    except ValueError:
        return None


def build_iv_smiles_panel(snapshot: dict[str, Any], forward_summary: dict[str, Any]) -> dict[str, Any]:
    forward = optional_float(forward_summary.get("parityForward")) or float(snapshot["forward"])
    rate = float(snapshot.get("risk_free_rate") or 0)
    tau = max(time_to_expiry_years(str(snapshot["snapshot_time"]), str(snapshot["expiry"])), 1 / (365 * 24 * 60 * 60))
    rows = list(snapshot.get("rows", []))
    raw_otm = _otm_midpoint_points(rows, forward, tau, rate)
    custom_points = _row_points(rows, "custom_iv")
    broker_points = _row_points(rows, "ibkr_iv")
    atm_straddle_points = _atm_straddle_points(forward_summary, forward, tau)
    fitted = _fit_methods(raw_otm, forward, tau)
    methods = [
        {"key": "custom_iv", "label": "Current custom IV", "status": "ok" if custom_points else "insufficient_data", "points": custom_points},
        {"key": "broker_iv", "label": "Broker IV diagnostic", "status": "preview" if broker_points else "insufficient_data", "points": broker_points},
        {"key": "otm_midpoint_black76", "label": "OTM midpoint Black-76", "status": "ok" if raw_otm else "insufficient_data", "points": raw_otm},
        {"key": "atm_straddle_iv", "label": "ATM straddle IV", "status": "preview" if atm_straddle_points else "insufficient_data", "points": atm_straddle_points},
        *fitted,
        {"key": "last_price", "label": "Last-price diagnostic", "status": "insufficient_data", "points": []},
    ]
    status = "preview" if any(method["points"] for method in methods) else "insufficient_data"
    return panel(
        status,
        "IV smile methods",
        [diagnostic("research_methods", "Fitted smile methods are experimental.", "info")],
        methods=methods,
    )


def smile_diagnostics_panel(iv_panel: dict[str, Any], forward: float) -> dict[str, Any]:
    spline = next((method for method in iv_panel.get("methods", []) if method.get("key") == "spline_fit"), None)
    points = _clean_points((spline or {}).get("points") or [])
    if not points:
        return _empty_smile_diagnostics_panel("No fitted smile is available.")
    finite_points = points
    if not finite_points:
        return _empty_smile_diagnostics_panel("No finite fitted smile points are available.")
    valley = min(finite_points, key=lambda point: float(point["y"]))
    atm = min(finite_points, key=lambda point: abs(float(point["x"]) - forward))
    left = finite_points[0]
    right = finite_points[-1]
    width = max(float(right["x"]) - float(left["x"]), 1.0)
    skew_slope = (float(right["y"]) - float(left["y"])) / width
    curvature = float(left["y"]) + float(right["y"]) - 2 * float(atm["y"])
    disagreement = _method_disagreement(iv_panel, float(atm["x"]))
    return panel(
        "preview",
        "Smile diagnostics",
        [],
        ivValley={"strike": float(valley["x"]), "value": float(valley["y"]), "label": "Spline valley"},
        atmForwardIv=float(atm["y"]),
        skewSlope=skew_slope,
        curvature=curvature,
        methodDisagreement=disagreement,
    )


def _row_points(rows: list[dict[str, Any]], key: str) -> list[dict[str, float]]:
    points = []
    for row in rows:
        strike = optional_float(row.get("strike"))
        value = optional_float(row.get(key))
        if strike is not None and strike > 0 and value is not None and value > 0:
            points.append({"x": strike, "y": value})
    return sorted(points, key=lambda point: point["x"])


def _otm_midpoint_points(rows: list[dict[str, Any]], forward: float, tau: float, rate: float) -> list[dict[str, float]]:
    points = []
    for pair in grouped_pairs(rows):
        if pair.strike < forward:
            selected = pair.put
            right: Right = "put"
        else:
            selected = pair.call
            right = "call"
        if selected is None or quote_flags(selected):
            continue
        price = optional_float(selected.get("mid"))
        if price is None:
            continue
        iv = implied_vol_black76(price=price, forward=forward, strike=pair.strike, tau=tau, rate=rate, right=right)
        if iv is not None and isfinite(iv):
            points.append({"x": pair.strike, "y": iv})
    return sorted(points, key=lambda point: point["x"])


def _atm_straddle_points(forward_summary: dict[str, Any], forward: float, tau: float) -> list[dict[str, float]]:
    straddle = optional_float(forward_summary.get("atmStraddle"))
    atm = optional_float(forward_summary.get("atmStrike"))
    if straddle is None or straddle <= 0 or atm is None or atm <= 0 or forward <= 0 or tau <= 0:
        return []
    iv = (straddle / forward) * sqrt(pi / (2 * tau))
    return [{"x": atm, "y": iv}]


def _fit_methods(points: list[dict[str, float]], forward: float, tau: float) -> list[dict[str, Any]]:
    if len(points) < 4 or forward <= 0 or tau <= 0:
        return [
            {"key": "spline_fit", "label": "Spline fit", "status": "insufficient_data", "points": []},
            {"key": "quadratic_fit", "label": "Quadratic fit", "status": "insufficient_data", "points": []},
            {"key": "wing_weighted_fit", "label": "Wing-weighted fit", "status": "insufficient_data", "points": []},
        ]
    x = np.array([log(point["x"] / forward) for point in points], dtype=float)
    strikes = np.array([point["x"] for point in points], dtype=float)
    total_variance = np.array([(point["y"] ** 2) * tau for point in points], dtype=float)
    order = np.argsort(x)
    x = x[order]
    strikes = strikes[order]
    total_variance = total_variance[order]
    grid = np.linspace(float(x.min()), float(x.max()), 80)
    grid_strikes = forward * np.exp(grid)

    spline = UnivariateSpline(x, total_variance, k=min(3, len(x) - 1), s=len(x) * 1e-7)
    spline_points = _fit_points(grid_strikes, spline(grid), tau)

    quadratic_coefficients = np.polyfit(x, total_variance, deg=2)
    quadratic_points = _fit_points(grid_strikes, np.polyval(quadratic_coefficients, grid), tau)

    weights = 1 + np.abs(x) / max(float(np.max(np.abs(x))), 1e-9)
    wing_coefficients = np.polyfit(x, total_variance, deg=2, w=weights)
    wing_points = _fit_points(grid_strikes, np.polyval(wing_coefficients, grid), tau)

    return [
        {"key": "spline_fit", "label": "Spline fit", "status": "preview", "points": spline_points},
        {"key": "quadratic_fit", "label": "Quadratic fit", "status": "preview", "points": quadratic_points},
        {"key": "wing_weighted_fit", "label": "Wing-weighted fit", "status": "preview", "points": wing_points},
    ]


def _fit_points(strikes: np.ndarray, total_variance: np.ndarray, tau: float) -> list[dict[str, float]]:
    clean = np.maximum(total_variance, 1e-12)
    ivs = np.sqrt(clean / tau)
    return [{"x": float(strike), "y": float(iv)} for strike, iv in zip(strikes, ivs)]


def _method_disagreement(iv_panel: dict[str, Any], reference_strike: float) -> float | None:
    method_values = []
    for method in iv_panel.get("methods", []):
        value = _nearest_value(method.get("points", []), reference_strike)
        if value is not None:
            method_values.append(value)
    if len(method_values) < 2:
        return None
    return max(method_values) - min(method_values)


def _nearest_value(points: list[dict[str, Any]], reference_strike: float) -> float | None:
    clean = _clean_points(points)
    if not clean:
        return None
    return min(clean, key=lambda point: abs(point["x"] - reference_strike))["y"]


def _clean_points(points: list[dict[str, Any]]) -> list[dict[str, float]]:
    clean = []
    for point in points:
        strike = optional_float(point.get("x"))
        value = optional_float(point.get("y"))
        if strike is not None and strike > 0 and value is not None and value > 0:
            clean.append({"x": strike, "y": value})
    return sorted(clean, key=lambda point: point["x"])


def _empty_smile_diagnostics_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Smile diagnostics",
        [diagnostic("missing_fit", message, "warning")],
        ivValley={"strike": None, "value": None, "label": None},
        atmForwardIv=None,
        skewSlope=None,
        curvature=None,
        methodDisagreement=None,
    )
