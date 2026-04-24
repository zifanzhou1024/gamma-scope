from datetime import UTC, datetime

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.events import (
    contract_discovered_event,
    contract_id,
    health_event,
    option_tick_event,
    underlying_tick_event,
)


EVENT_TIME = datetime(2026, 4, 23, 15, 30, tzinfo=UTC)


def assert_contract_event(event: dict[str, object]) -> None:
    CollectorEvents.model_validate(event)
    assert event["schema_version"] == "1.0.0"
    assert event["source"] == "ibkr"


def test_health_event_matches_collector_contract() -> None:
    event = health_event(
        collector_id="local-dev",
        status="connected",
        ibkr_account_mode="paper",
        message="Mock connected",
        event_time=EVENT_TIME,
        received_time=EVENT_TIME,
    )

    assert_contract_event(event)
    assert event["collector_id"] == "local-dev"
    assert event["status"] == "connected"


def test_contract_discovery_uses_stable_contract_id() -> None:
    event = contract_discovered_event(
        session_id="live-spx-local-mock",
        ibkr_con_id=123456,
        symbol="SPX",
        expiry="2026-04-23",
        right="call",
        strike=5200,
        event_time=EVENT_TIME,
    )

    assert_contract_event(event)
    assert event["contract_id"] == "SPX-2026-04-23-C-5200"
    assert contract_id("SPX", "2026-04-23", "put", 5210.5) == "SPX-2026-04-23-P-5210.5"


def test_underlying_tick_derives_mark_from_bid_and_ask() -> None:
    event = underlying_tick_event(
        session_id="live-spx-local-mock",
        bid=5199.75,
        ask=5200.75,
        last=5200.25,
        event_time=EVENT_TIME,
    )

    assert_contract_event(event)
    assert event["symbol"] == "SPX"
    assert event["spot"] == 5200.25
    assert event["mark"] == 5200.25
    assert event["quote_status"] == "valid"


def test_option_tick_marks_crossed_quotes() -> None:
    event = option_tick_event(
        session_id="live-spx-local-mock",
        contract_id="SPX-2026-04-23-C-5200",
        bid=5.25,
        ask=5.0,
        last=5.1,
        bid_size=12,
        ask_size=9,
        volume=120,
        open_interest=2400,
        ibkr_iv=0.18,
        ibkr_delta=0.51,
        ibkr_gamma=0.012,
        ibkr_vega=0.8,
        ibkr_theta=-1.2,
        event_time=EVENT_TIME,
    )

    assert_contract_event(event)
    assert event["quote_status"] == "crossed"
