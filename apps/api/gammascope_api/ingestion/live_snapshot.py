from __future__ import annotations

from datetime import UTC, datetime, time
from math import exp
from typing import Any

from gammascope_api.analytics.black_scholes import (
    BlackScholesInputs,
    calculate_row_analytics,
    display_vanna_per_vol_point,
    gamma as black_scholes_gamma,
    mid_price,
    raw_vanna,
)
from gammascope_api.ingestion.collector_state import CollectorState

DEFAULT_RISK_FREE_RATE = 0.05
DEFAULT_DIVIDEND_YIELD = 0.01
DEFAULT_EXPIRY_CUTOFF_UTC = time(hour=20, minute=0, tzinfo=UTC)
MIN_TAU_YEARS = 1 / (365 * 24 * 60 * 60)
_ANALYTICS_MEMORY_FIELDS = ("custom_iv", "custom_gamma", "custom_vanna")
_analytics_memory: dict[tuple[str, str], dict[str, float]] = {}


def reset_live_snapshot_memory() -> None:
    _analytics_memory.clear()


def build_live_snapshot(state: CollectorState) -> dict[str, Any] | None:
    health = state.latest_health()
    underlying = state.latest_underlying_tick()
    contracts = state.contracts()
    option_ticks = state.option_ticks()

    if health is None or underlying is None or not contracts or not option_ticks:
        return None

    session_id = str(underlying["session_id"])
    contracts = [contract for contract in contracts if str(contract["session_id"]) == session_id]
    option_ticks = {
        contract_id: option_tick
        for contract_id, option_tick in option_ticks.items()
        if str(option_tick["session_id"]) == session_id
    }
    if not contracts or not option_ticks:
        return None

    snapshot_time = state.last_event_time() or underlying["event_time"]
    expiry = _active_expiry(contracts=contracts, option_ticks=option_ticks)
    if expiry is None:
        return None
    contracts = [contract for contract in contracts if str(contract["expiry"]) == expiry]
    active_contract_ids = {str(contract["contract_id"]) for contract in contracts}
    option_ticks = {
        contract_id: option_tick for contract_id, option_tick in option_ticks.items() if contract_id in active_contract_ids
    }
    if not contracts or not option_ticks:
        return None

    spot = _spot_from_underlying(underlying)
    if spot is None or spot <= 0:
        return None

    tau = _time_to_expiry_years(str(snapshot_time), expiry)
    forward = spot * exp((DEFAULT_RISK_FREE_RATE - DEFAULT_DIVIDEND_YIELD) * tau)
    discount_factor = exp(-DEFAULT_RISK_FREE_RATE * tau)
    rows: list[dict[str, Any]] = []
    active_contract_ids: set[str] = set()
    for contract in sorted(contracts, key=lambda item: (float(item["strike"]), str(item["right"]))):
        contract_id = str(contract["contract_id"])
        if contract_id not in option_ticks:
            continue
        row = _analytics_row(contract=contract, option_tick=option_ticks[contract_id], spot=spot, tau=tau)
        _apply_analytics_memory(session_id=session_id, row=row)
        rows.append(row)
        active_contract_ids.add(contract_id)

    if not rows:
        return None
    _prune_analytics_memory(session_id=session_id, active_contract_ids=active_contract_ids)

    return {
        "schema_version": "1.0.0",
        "session_id": session_id,
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


def _active_expiry(*, contracts: list[dict[str, Any]], option_ticks: dict[str, dict[str, Any]]) -> str | None:
    ticked_contracts = [
        contract for contract in contracts if str(contract["contract_id"]) in option_ticks and contract.get("expiry") is not None
    ]
    if not ticked_contracts:
        return None
    active_contract = max(
        ticked_contracts,
        key=lambda contract: (
            str(option_ticks[str(contract["contract_id"])].get("event_time") or ""),
            str(contract.get("event_time") or ""),
            str(contract["expiry"]),
        ),
    )
    return str(active_contract["expiry"])


def _apply_analytics_memory(*, session_id: str, row: dict[str, Any]) -> None:
    memory_key = (session_id, str(row["contract_id"]))
    previous_values = _analytics_memory.get(memory_key)
    fallback_values = row.pop("_fallback_custom_analytics", {})

    if previous_values is not None:
        for field in _ANALYTICS_MEMORY_FIELDS:
            if row.get(field) is None and field in previous_values:
                row[field] = previous_values[field]

    for field in _ANALYTICS_MEMORY_FIELDS:
        if row.get(field) is None and field in fallback_values:
            row[field] = fallback_values[field]

    current_values = {
        field: value
        for field in _ANALYTICS_MEMORY_FIELDS
        if (value := _float_or_none(row.get(field))) is not None
    }
    if current_values:
        _analytics_memory[memory_key] = current_values

    _refresh_comparison_diffs(row)


def _refresh_comparison_diffs(row: dict[str, Any]) -> None:
    custom_iv = _float_or_none(row.get("custom_iv"))
    ibkr_iv = _float_or_none(row.get("ibkr_iv"))
    row["iv_diff"] = custom_iv - ibkr_iv if custom_iv is not None and ibkr_iv is not None else None

    custom_gamma = _float_or_none(row.get("custom_gamma"))
    ibkr_gamma = _float_or_none(row.get("ibkr_gamma"))
    row["gamma_diff"] = custom_gamma - ibkr_gamma if custom_gamma is not None and ibkr_gamma is not None else None


def _prune_analytics_memory(*, session_id: str, active_contract_ids: set[str]) -> None:
    for memory_key in list(_analytics_memory):
        memory_session_id, contract_id = memory_key
        if memory_session_id == session_id and contract_id not in active_contract_ids:
            del _analytics_memory[memory_key]


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

    fallback_values = {}
    if result.custom_iv is None or result.custom_gamma is None or result.custom_vanna is None:
        fallback_values = _raw_iv_fallback_analytics(
            spot=spot,
            strike=float(contract["strike"]),
            tau=tau,
            ibkr_iv=_float_or_none(option_tick.get("ibkr_iv")),
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
        "_fallback_custom_analytics": fallback_values,
    }


def _raw_iv_fallback_analytics(
    *,
    spot: float,
    strike: float,
    tau: float,
    ibkr_iv: float | None,
) -> dict[str, float]:
    if ibkr_iv is None or ibkr_iv <= 0:
        return {}

    inputs = BlackScholesInputs(
        spot=spot,
        strike=strike,
        tau=tau,
        rate=DEFAULT_RISK_FREE_RATE,
        dividend_yield=DEFAULT_DIVIDEND_YIELD,
        sigma=ibkr_iv,
    )
    try:
        return {
            "custom_iv": ibkr_iv,
            "custom_gamma": black_scholes_gamma(inputs),
            "custom_vanna": display_vanna_per_vol_point(raw_vanna(inputs)),
        }
    except (OverflowError, ValueError):
        return {}


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
