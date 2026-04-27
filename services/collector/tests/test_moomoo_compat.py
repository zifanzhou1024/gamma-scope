from __future__ import annotations

import json
from datetime import date

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.moomoo_compat import moomoo_rows_to_spx_events, synthetic_ibkr_con_id
from gammascope_collector.moomoo_snapshot import MoomooOptionRow


def _row(
    symbol: str,
    option_code: str,
    option_type: str,
    strike: float,
    *,
    bid: float = 1.1,
    ask: float = 1.3,
    last: float = 1.2,
) -> MoomooOptionRow:
    return MoomooOptionRow(
        symbol=symbol,
        owner_code=f"US.{symbol}",
        option_code=option_code,
        option_type=option_type,
        strike=strike,
        expiry=date(2026, 4, 27),
        name=option_code,
        last_price=last,
        bid_price=bid,
        ask_price=ask,
        bid_size=10,
        ask_size=11,
        volume=100,
        open_interest=200,
        implied_volatility=0.22,
        delta=0.51 if option_type == "CALL" else -0.49,
        gamma=0.02,
        vega=0.15,
        theta=-0.04,
        contract_multiplier=100,
    )


def _event_type(event: dict[str, object]) -> str:
    parsed = CollectorEvents.model_validate(event).root
    return type(parsed).__name__


def test_synthetic_ibkr_con_id_is_stable_positive_and_distinct() -> None:
    first = synthetic_ibkr_con_id("US.SPXW260427C07050000")
    second = synthetic_ibkr_con_id("US.SPXW260427C07050000")
    other = synthetic_ibkr_con_id("US.SPXW260427P07050000")

    assert first == second
    assert first > 0
    assert other > 0
    assert first != other


def test_synthetic_ibkr_con_id_does_not_collide_for_known_hash_mod_pair() -> None:
    first = synthetic_ibkr_con_id("US.SPXW260427C00032042")
    second = synthetic_ibkr_con_id("US.SPXW260427C00089630")

    assert first != second


def test_moomoo_rows_to_spx_events_filters_non_spx_and_validates_events() -> None:
    events = moomoo_rows_to_spx_events(
        session_id="session-1",
        collector_id="collector-1",
        spot=7050.25,
        rows=[
            _row("SPX", "US.SPXW260427C07050000", "CALL", 7050),
            _row("SPY", "US.SPY260427C00500000", "CALL", 500),
        ],
        status="connected",
        message="ok",
    )

    assert [_event_type(event) for event in events] == [
        "CollectorHealth",
        "UnderlyingTick",
        "ContractDiscovered",
        "OptionTick",
    ]
    for event in events:
        CollectorEvents.model_validate(event)


def test_moomoo_rows_to_spx_events_returns_expected_event_order() -> None:
    events = moomoo_rows_to_spx_events(
        session_id="session-1",
        collector_id="collector-1",
        spot=7050.25,
        rows=[
            _row("SPX", "US.SPXW260427C07050000", "CALL", 7050),
            _row("SPY", "US.SPY260427C00500000", "CALL", 500),
            _row("SPX", "US.SPXW260427P07050000", "PUT", 7050),
        ],
        status="connected",
        message="ok",
    )

    assert [_event_type(event) for event in events] == [
        "CollectorHealth",
        "UnderlyingTick",
        "ContractDiscovered",
        "ContractDiscovered",
        "OptionTick",
        "OptionTick",
    ]


def test_moomoo_rows_to_spx_events_uses_ibkr_source_and_never_leaks_spy() -> None:
    events = moomoo_rows_to_spx_events(
        session_id="session-1",
        collector_id="collector-1",
        spot=7050.25,
        rows=[
            _row("SPX", "US.SPXW260427C07050000", "CALL", 7050),
            _row("SPY", "US.SPY260427P00500000", "PUT", 500),
        ],
        status="connected",
        message="ok",
    )

    assert {event["source"] for event in events} == {"ibkr"}
    assert {event["symbol"] for event in events if "symbol" in event} == {"SPX"}
    assert "SPY" not in json.dumps(events, sort_keys=True)


def test_moomoo_rows_to_spx_events_returns_health_only_without_publishable_rows_or_spot() -> None:
    no_spx_events = moomoo_rows_to_spx_events(
        session_id="session-1",
        collector_id="collector-1",
        spot=7050.25,
        rows=[_row("SPY", "US.SPY260427P00500000", "PUT", 500)],
        status="degraded",
        message="no rows",
    )
    missing_spot_events = moomoo_rows_to_spx_events(
        session_id="session-1",
        collector_id="collector-1",
        spot=None,
        rows=[_row("SPX", "US.SPXW260427C07050000", "CALL", 7050)],
        status="degraded",
        message="no spot",
    )

    assert [_event_type(event) for event in no_spx_events] == ["CollectorHealth"]
    assert [_event_type(event) for event in missing_spot_events] == ["CollectorHealth"]
