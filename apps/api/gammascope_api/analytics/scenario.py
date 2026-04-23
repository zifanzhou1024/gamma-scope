from __future__ import annotations

from copy import deepcopy
from datetime import datetime, time, timezone
from math import exp
from typing import Any

from gammascope_api.analytics.black_scholes import (
    BlackScholesInputs,
    display_vanna_per_vol_point,
    gamma,
    raw_vanna,
)


DEFAULT_EXPIRY_CUTOFF_UTC = time(hour=20, minute=0, tzinfo=timezone.utc)
MIN_TAU_YEARS = 1 / (365 * 24 * 60 * 60)


def create_scenario_snapshot(base_snapshot: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    scenario = deepcopy(base_snapshot)
    spot_shift = float(request_payload.get("spot_shift_points", 0))
    vol_shift_points = float(request_payload.get("vol_shift_points", 0))
    time_shift_minutes = float(request_payload.get("time_shift_minutes", 0))

    base_tau = _time_to_expiry_years(scenario["snapshot_time"], scenario["expiry"])
    shifted_tau = max(base_tau + time_shift_minutes / (365 * 24 * 60), MIN_TAU_YEARS)
    shifted_spot = float(scenario["spot"]) + spot_shift
    rate = float(scenario["risk_free_rate"])
    dividend_yield = float(scenario["dividend_yield"])

    scenario["mode"] = "scenario"
    scenario["spot"] = shifted_spot
    scenario["forward"] = shifted_spot * exp((rate - dividend_yield) * shifted_tau)
    scenario["discount_factor"] = exp(-rate * shifted_tau)
    scenario["scenario_params"] = {
        "spot_shift_points": spot_shift,
        "vol_shift_points": vol_shift_points,
        "time_shift_minutes": time_shift_minutes,
    }
    scenario["rows"] = [
        _scenario_row(
            row=row,
            shifted_spot=shifted_spot,
            shifted_tau=shifted_tau,
            rate=rate,
            dividend_yield=dividend_yield,
            vol_shift_points=vol_shift_points,
        )
        for row in scenario["rows"]
    ]
    return scenario


def _scenario_row(
    *,
    row: dict[str, Any],
    shifted_spot: float,
    shifted_tau: float,
    rate: float,
    dividend_yield: float,
    vol_shift_points: float,
) -> dict[str, Any]:
    scenario_row = deepcopy(row)
    base_iv = scenario_row.get("custom_iv")
    shifted_iv = None if base_iv is None else float(base_iv) + vol_shift_points * 0.01

    if shifted_iv is None or shifted_iv <= 0 or shifted_spot <= 0 or shifted_tau <= 0:
        scenario_row["custom_iv"] = None
        scenario_row["custom_gamma"] = None
        scenario_row["custom_vanna"] = None
        scenario_row["iv_diff"] = None
        scenario_row["gamma_diff"] = None
        scenario_row["calc_status"] = "out_of_model_scope"
        scenario_row["comparison_status"] = _comparison_status(scenario_row)
        return scenario_row

    inputs = BlackScholesInputs(
        spot=shifted_spot,
        strike=float(scenario_row["strike"]),
        tau=shifted_tau,
        rate=rate,
        dividend_yield=dividend_yield,
        sigma=shifted_iv,
    )
    custom_gamma = gamma(inputs)
    custom_vanna = display_vanna_per_vol_point(raw_vanna(inputs))

    scenario_row["custom_iv"] = shifted_iv
    scenario_row["custom_gamma"] = custom_gamma
    scenario_row["custom_vanna"] = custom_vanna
    scenario_row["iv_diff"] = shifted_iv - scenario_row["ibkr_iv"] if scenario_row.get("ibkr_iv") is not None else None
    scenario_row["gamma_diff"] = (
        custom_gamma - scenario_row["ibkr_gamma"] if scenario_row.get("ibkr_gamma") is not None else None
    )
    scenario_row["calc_status"] = "ok"
    scenario_row["comparison_status"] = _comparison_status(scenario_row)
    return scenario_row


def _time_to_expiry_years(snapshot_time: str, expiry: str) -> float:
    snapshot_dt = _parse_datetime(snapshot_time)
    expiry_date = datetime.fromisoformat(expiry).date()
    expiry_dt = datetime.combine(expiry_date, DEFAULT_EXPIRY_CUTOFF_UTC)
    seconds = max((expiry_dt - snapshot_dt).total_seconds(), 1)
    return seconds / (365 * 24 * 60 * 60)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _comparison_status(row: dict[str, Any]) -> str:
    if row.get("ibkr_iv") is None and row.get("ibkr_gamma") is None:
        return "missing"
    return "ok"
