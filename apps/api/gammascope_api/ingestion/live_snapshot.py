from __future__ import annotations

from datetime import UTC, datetime, time
from math import exp
from typing import Any

from gammascope_api.analytics.black_scholes import calculate_row_analytics, mid_price
from gammascope_api.ingestion.collector_state import CollectorState

DEFAULT_RISK_FREE_RATE = 0.05
DEFAULT_DIVIDEND_YIELD = 0.01
DEFAULT_EXPIRY_CUTOFF_UTC = time(hour=20, minute=0, tzinfo=UTC)
MIN_TAU_YEARS = 1 / (365 * 24 * 60 * 60)


def build_live_snapshot(state: CollectorState) -> dict[str, Any] | None:
    health = state.latest_health()
    underlying = state.latest_underlying_tick()
    contracts = state.contracts()
    option_ticks = state.option_ticks()

    if health is None or underlying is None or not contracts or not option_ticks:
        return None

    snapshot_time = state.last_event_time() or underlying["event_time"]
    expiry = str(contracts[0]["expiry"])
    spot = _spot_from_underlying(underlying)
    if spot is None or spot <= 0:
        return None

    tau = _time_to_expiry_years(str(snapshot_time), expiry)
    forward = spot * exp((DEFAULT_RISK_FREE_RATE - DEFAULT_DIVIDEND_YIELD) * tau)
    discount_factor = exp(-DEFAULT_RISK_FREE_RATE * tau)
    rows = [
        _analytics_row(contract=contract, option_tick=option_ticks[contract["contract_id"]], spot=spot, tau=tau)
        for contract in sorted(contracts, key=lambda item: (float(item["strike"]), str(item["right"])))
        if contract["contract_id"] in option_ticks
    ]

    if not rows:
        return None

    return {
        "schema_version": "1.0.0",
        "session_id": str(underlying["session_id"]),
        "mode": "live",
        "symbol": "SPX",
        "expiry": expiry,
        "snapshot_time": snapshot_time,
        "spot": spot,
        "forward": forward,
        "discount_factor": discount_factor,
        "risk_free_rate": DEFAULT_RISK_FREE_RATE,
        "dividend_yield": DEFAULT_DIVIDEND_YIELD,
        "source_status": health["status"],
        "freshness_ms": _freshness_ms(str(snapshot_time)),
        "coverage_status": "partial",
        "scenario_params": None,
        "rows": rows,
    }


def _analytics_row(
    *,
    contract: dict[str, Any],
    option_tick: dict[str, Any],
    spot: float,
    tau: float,
) -> dict[str, Any]:
    bid = option_tick.get("bid")
    ask = option_tick.get("ask")
    mid, _ = mid_price(_float_or_none(bid), _float_or_none(ask))
    result = calculate_row_analytics(
        right=contract["right"],
        spot=spot,
        strike=float(contract["strike"]),
        tau=tau,
        rate=DEFAULT_RISK_FREE_RATE,
        dividend_yield=DEFAULT_DIVIDEND_YIELD,
        bid=_float_or_none(bid),
        ask=_float_or_none(ask),
        ibkr_iv=_float_or_none(option_tick.get("ibkr_iv")),
        ibkr_gamma=_float_or_none(option_tick.get("ibkr_gamma")),
    )

    return {
        "contract_id": contract["contract_id"],
        "right": contract["right"],
        "strike": contract["strike"],
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "open_interest": _int_or_none(option_tick.get("open_interest")),
        "custom_iv": result.custom_iv,
        "custom_gamma": result.custom_gamma,
        "custom_vanna": result.custom_vanna,
        "ibkr_iv": option_tick.get("ibkr_iv"),
        "ibkr_gamma": option_tick.get("ibkr_gamma"),
        "ibkr_vanna": None,
        "iv_diff": result.iv_diff,
        "gamma_diff": result.gamma_diff,
        "calc_status": result.calc_status,
        "comparison_status": result.comparison_status,
    }


def _spot_from_underlying(underlying: dict[str, Any]) -> float | None:
    return _float_or_none(underlying.get("spot") or underlying.get("mark") or underlying.get("last"))


def _time_to_expiry_years(snapshot_time: str, expiry: str) -> float:
    snapshot_dt = _parse_datetime(snapshot_time)
    expiry_date = datetime.fromisoformat(expiry).date()
    expiry_dt = datetime.combine(expiry_date, DEFAULT_EXPIRY_CUTOFF_UTC)
    seconds = max((expiry_dt - snapshot_dt).total_seconds(), 1)
    return seconds / (365 * 24 * 60 * 60)


def _freshness_ms(snapshot_time: str) -> int:
    age = datetime.now(UTC) - _parse_datetime(snapshot_time)
    return max(0, int(age.total_seconds() * 1000))


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _int_or_none(value: object) -> int | None:
    if value is None:
        return None
    return int(value)
