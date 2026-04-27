from __future__ import annotations

import hashlib
import math
from collections.abc import Iterable
from datetime import date, datetime
from typing import cast

from gammascope_collector.events import (
    Right,
    contract_discovered_event,
    contract_id,
    health_event,
    option_tick_event,
    underlying_tick_event,
    utc_now,
)
from gammascope_collector.moomoo_snapshot import MoomooOptionRow

_MAX_SYNTHETIC_CON_ID = 2_147_483_647


def synthetic_ibkr_con_id(option_code: str) -> int:
    digest = hashlib.blake2b(option_code.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % _MAX_SYNTHETIC_CON_ID + 1


def moomoo_rows_to_spx_events(
    session_id: str,
    collector_id: str,
    spot: float | None,
    rows: Iterable[MoomooOptionRow],
    status: str,
    message: str,
) -> list[dict[str, object]]:
    spx_rows = [row for row in rows if row.symbol == "SPX" and _positive_float_or_none(row.strike) is not None]
    spot = _finite_float_or_none(spot)
    event_time = utc_now()
    events = [
        health_event(
            collector_id=collector_id,
            status=status,
            ibkr_account_mode="unknown",
            message=message,
            event_time=event_time,
        )
    ]
    if spot is None or not spx_rows:
        return events

    events.append(
        underlying_tick_event(
            session_id=session_id,
            symbol="SPX",
            bid=None,
            ask=None,
            last=spot,
            event_time=event_time,
        )
    )
    events.extend(_contract_event(session_id, row, event_time) for row in spx_rows)
    events.extend(_option_tick_event(session_id, row, event_time) for row in spx_rows)
    return events


def _contract_event(session_id: str, row: MoomooOptionRow, event_time: datetime) -> dict[str, object]:
    expiry = _expiry_text(row.expiry)
    right = _right(row.option_type)
    strike = _positive_float_or_none(row.strike)
    if strike is None:
        raise ValueError(f"Unsupported Moomoo strike: {row.strike}")
    return contract_discovered_event(
        session_id=session_id,
        ibkr_con_id=synthetic_ibkr_con_id(row.option_code),
        symbol="SPX",
        expiry=expiry,
        right=right,
        strike=strike,
        multiplier=_finite_float_or_none(row.contract_multiplier) or 100.0,
        exchange="CBOE",
        currency="USD",
        event_time=event_time,
    )


def _option_tick_event(session_id: str, row: MoomooOptionRow, event_time: datetime) -> dict[str, object]:
    expiry = _expiry_text(row.expiry)
    right = _right(row.option_type)
    strike = _positive_float_or_none(row.strike)
    if strike is None:
        raise ValueError(f"Unsupported Moomoo strike: {row.strike}")
    return option_tick_event(
        session_id=session_id,
        contract_id=contract_id("SPX", expiry, right, strike),
        bid=_finite_float_or_none(row.bid_price),
        ask=_finite_float_or_none(row.ask_price),
        last=_finite_float_or_none(row.last_price),
        bid_size=_finite_float_or_none(row.bid_size),
        ask_size=_finite_float_or_none(row.ask_size),
        volume=_finite_float_or_none(row.volume),
        open_interest=_finite_float_or_none(row.open_interest),
        ibkr_iv=_finite_float_or_none(row.implied_volatility),
        ibkr_delta=_finite_float_or_none(row.delta),
        ibkr_gamma=_finite_float_or_none(row.gamma),
        ibkr_vega=_finite_float_or_none(row.vega),
        ibkr_theta=_finite_float_or_none(row.theta),
        event_time=event_time,
    )


def _expiry_text(value: date) -> str:
    return value.isoformat()


def _right(value: str) -> Right:
    normalized = value.lower()
    if normalized not in ("call", "put"):
        raise ValueError(f"Unsupported Moomoo option type: {value}")
    return cast(Right, normalized)


def _finite_float_or_none(value: object) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return result


def _positive_float_or_none(value: object) -> float | None:
    result = _finite_float_or_none(value)
    if result is None or result <= 0:
        return None
    return result


__all__ = ["moomoo_rows_to_spx_events", "synthetic_ibkr_con_id"]
