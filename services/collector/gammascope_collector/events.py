from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

Right = Literal["call", "put"]


def utc_now() -> datetime:
    return datetime.now(UTC)


def health_event(
    *,
    collector_id: str,
    status: str,
    ibkr_account_mode: str,
    message: str,
    event_time: datetime | None = None,
    received_time: datetime | None = None,
) -> dict[str, object]:
    now = utc_now()
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": collector_id,
        "status": status,
        "ibkr_account_mode": ibkr_account_mode,
        "message": message,
        "event_time": _format_time(event_time or now),
        "received_time": _format_time(received_time or now),
    }


def contract_id(symbol: str, expiry: str, right: Right, strike: float) -> str:
    right_code = "C" if right == "call" else "P"
    return f"{symbol}-{expiry}-{right_code}-{_format_strike(strike)}"


def contract_discovered_event(
    *,
    session_id: str,
    ibkr_con_id: int,
    symbol: str,
    expiry: str,
    right: Right,
    strike: float,
    multiplier: float = 100,
    exchange: str = "CBOE",
    currency: str = "USD",
    event_time: datetime | None = None,
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id(symbol, expiry, right, strike),
        "ibkr_con_id": ibkr_con_id,
        "symbol": symbol,
        "expiry": expiry,
        "right": right,
        "strike": strike,
        "multiplier": multiplier,
        "exchange": exchange,
        "currency": currency,
        "event_time": _format_time(event_time or utc_now()),
    }


def underlying_tick_event(
    *,
    session_id: str,
    bid: float | None,
    ask: float | None,
    last: float | None,
    event_time: datetime | None = None,
    symbol: str = "SPX",
) -> dict[str, object]:
    mark = _midpoint(bid, ask)
    spot = last if last is not None else mark
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "symbol": symbol,
        "spot": spot,
        "bid": bid,
        "ask": ask,
        "last": last,
        "mark": mark,
        "event_time": _format_time(event_time or utc_now()),
        "quote_status": _underlying_quote_status(bid, ask, last),
    }


def option_tick_event(
    *,
    session_id: str,
    contract_id: str,
    bid: float | None,
    ask: float | None,
    last: float | None,
    bid_size: float | None,
    ask_size: float | None,
    volume: float | None,
    open_interest: float | None,
    ibkr_iv: float | None,
    ibkr_delta: float | None,
    ibkr_gamma: float | None,
    ibkr_vega: float | None,
    ibkr_theta: float | None,
    event_time: datetime | None = None,
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": bid,
        "ask": ask,
        "last": last,
        "bid_size": bid_size,
        "ask_size": ask_size,
        "volume": volume,
        "open_interest": open_interest,
        "ibkr_iv": ibkr_iv,
        "ibkr_delta": ibkr_delta,
        "ibkr_gamma": ibkr_gamma,
        "ibkr_vega": ibkr_vega,
        "ibkr_theta": ibkr_theta,
        "event_time": _format_time(event_time or utc_now()),
        "quote_status": _option_quote_status(bid, ask),
    }


def _format_time(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _format_strike(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _midpoint(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None:
        return None
    return (bid + ask) / 2


def _underlying_quote_status(bid: float | None, ask: float | None, last: float | None) -> str:
    if bid is None and ask is None and last is None:
        return "missing"
    if _has_negative(bid, ask, last) or (bid is not None and ask is not None and bid > ask):
        return "invalid"
    return "valid"


def _option_quote_status(bid: float | None, ask: float | None) -> str:
    if bid is None or ask is None:
        return "missing"
    if _has_negative(bid, ask):
        return "invalid"
    if bid > ask:
        return "crossed"
    return "valid"


def _has_negative(*values: float | None) -> bool:
    return any(value is not None and value < 0 for value in values)
