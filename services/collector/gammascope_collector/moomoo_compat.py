from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import date
from typing import cast

from gammascope_collector.events import (
    Right,
    contract_discovered_event,
    contract_id,
    health_event,
    option_tick_event,
    underlying_tick_event,
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
    spx_rows = [row for row in rows if row.symbol == "SPX"]
    events = [
        health_event(
            collector_id=collector_id,
            status=status,
            ibkr_account_mode="unknown",
            message=message,
        )
    ]
    if spot is None or not spx_rows:
        return events

    events.append(underlying_tick_event(session_id=session_id, symbol="SPX", bid=None, ask=None, last=spot))
    events.extend(_contract_event(session_id, row) for row in spx_rows)
    events.extend(_option_tick_event(session_id, row) for row in spx_rows)
    return events


def _contract_event(session_id: str, row: MoomooOptionRow) -> dict[str, object]:
    expiry = _expiry_text(row.expiry)
    right = _right(row.option_type)
    return contract_discovered_event(
        session_id=session_id,
        ibkr_con_id=synthetic_ibkr_con_id(row.option_code),
        symbol="SPX",
        expiry=expiry,
        right=right,
        strike=row.strike,
        multiplier=row.contract_multiplier or 100.0,
        exchange="CBOE",
        currency="USD",
    )


def _option_tick_event(session_id: str, row: MoomooOptionRow) -> dict[str, object]:
    expiry = _expiry_text(row.expiry)
    right = _right(row.option_type)
    return option_tick_event(
        session_id=session_id,
        contract_id=contract_id("SPX", expiry, right, row.strike),
        bid=row.bid_price,
        ask=row.ask_price,
        last=row.last_price,
        bid_size=row.bid_size,
        ask_size=row.ask_size,
        volume=row.volume,
        open_interest=row.open_interest,
        ibkr_iv=row.implied_volatility,
        ibkr_delta=row.delta,
        ibkr_gamma=row.gamma,
        ibkr_vega=row.vega,
        ibkr_theta=row.theta,
    )


def _expiry_text(value: date) -> str:
    return value.isoformat()


def _right(value: str) -> Right:
    normalized = value.lower()
    if normalized not in ("call", "put"):
        raise ValueError(f"Unsupported Moomoo option type: {value}")
    return cast(Right, normalized)


__all__ = ["moomoo_rows_to_spx_events", "synthetic_ibkr_con_id"]
