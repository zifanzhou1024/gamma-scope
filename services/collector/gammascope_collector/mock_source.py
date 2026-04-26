from __future__ import annotations

from datetime import datetime
from math import exp
from typing import Iterable

from gammascope_collector.events import (
    Right,
    contract_discovered_event,
    contract_id,
    health_event,
    option_tick_event,
    underlying_tick_event,
    utc_now,
)


def build_mock_cycle(
    *,
    spot: float,
    expiry: str,
    strikes: Iterable[float],
    session_id: str = "live-spx-local-mock",
    collector_id: str = "local-dev",
    event_time: datetime | None = None,
) -> list[dict[str, object]]:
    timestamp = event_time or utc_now()
    strike_list = list(strikes)
    events: list[dict[str, object]] = [
        health_event(
            collector_id=collector_id,
            status="connected",
            ibkr_account_mode="paper",
            message="Mock collector cycle emitted",
            event_time=timestamp,
            received_time=timestamp,
        ),
        underlying_tick_event(
            session_id=session_id,
            bid=round(spot - 0.5, 2),
            ask=round(spot + 0.5, 2),
            last=spot,
            event_time=timestamp,
        ),
    ]

    for index, strike in enumerate(strike_list):
        for right in ("call", "put"):
            events.append(
                contract_discovered_event(
                    session_id=session_id,
                    ibkr_con_id=_mock_con_id(index, right),
                    symbol="SPX",
                    expiry=expiry,
                    right=right,
                    strike=strike,
                    event_time=timestamp,
                )
            )

    for strike in strike_list:
        for right in ("call", "put"):
            events.append(
                option_tick_event(
                    session_id=session_id,
                    contract_id=contract_id("SPX", expiry, right, strike),
                    event_time=timestamp,
                    **_mock_quote(spot=spot, strike=strike, right=right),
                )
            )

    return events


def _mock_con_id(index: int, right: Right) -> int:
    return 900_000 + index * 2 + (0 if right == "call" else 1)


def _mock_quote(spot: float, strike: float, right: Right) -> dict[str, float]:
    distance = strike - spot
    intrinsic = max(spot - strike, 0) if right == "call" else max(strike - spot, 0)
    time_value = max(0.05, 10.0 * exp(-abs(distance) / 45.0))
    mid = intrinsic + time_value
    spread = max(0.05, min(0.5, mid * 0.01))
    bid = max(0.01, mid - spread / 2)
    ask = mid + spread / 2
    iv = 0.18 + abs(distance) / 10_000
    gamma = max(0.00002, 0.020 * exp(-abs(distance) / 28.0))
    delta_sign = 1 if right == "call" else -1
    delta = delta_sign * max(0.05, min(0.95, 0.5 - distance / 180.0))

    return {
        "bid": round(bid, 2),
        "ask": round(ask, 2),
        "last": round(mid, 2),
        "bid_size": 10,
        "ask_size": 12,
        "volume": round(1200 / (1 + abs(distance) / 20)),
        "open_interest": round(1800 / (1 + abs(distance) / 50)),
        "ibkr_iv": round(iv, 6),
        "ibkr_delta": round(delta, 6),
        "ibkr_gamma": round(gamma, 8),
        "ibkr_vega": round(max(0.02, 0.9 * exp(-abs(distance) / 40.0)), 6),
        "ibkr_theta": round(-1.0 * max(0.02, mid / 25), 6),
    }
