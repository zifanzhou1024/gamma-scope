import sys
import types

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import (
    RedisLatestStateCache,
    cached_or_memory_collector_state,
    reset_latest_state_cache_override,
    set_latest_state_cache_override,
)


def setup_function() -> None:
    collector_state.clear()


def teardown_function() -> None:
    collector_state.clear()
    reset_latest_state_cache_override()


def test_cached_or_memory_state_prefers_richer_memory_on_equal_event_time() -> None:
    event_time = "2026-04-24T15:30:00Z"
    set_latest_state_cache_override(
        StaticLatestStateCache(
            {
                "health_events": {"local-dev": _health_event(event_time)},
                "contracts": {},
                "underlying_ticks": {},
                "option_ticks": {},
                "last_event_time": event_time,
            }
        )
    )
    for event in [
        _health_event(event_time),
        _underlying_event("same-time-session", event_time),
        _contract_event("same-time-session", "SPX-2026-04-24-C-5200", event_time),
        _option_event("same-time-session", "SPX-2026-04-24-C-5200", event_time),
    ]:
        collector_state.ingest(CollectorEvents.model_validate(event))

    selected_state = cached_or_memory_collector_state()

    assert selected_state.summary()["contracts_count"] == 1
    assert selected_state.summary()["underlying_ticks_count"] == 1
    assert selected_state.summary()["option_ticks_count"] == 1


def test_cached_or_memory_state_parses_timestamps_before_comparing_freshness() -> None:
    set_latest_state_cache_override(
        StaticLatestStateCache(
            {
                "health_events": {"local-dev": _health_event("2026-04-24T15:30:30Z")},
                "contracts": {},
                "underlying_ticks": {},
                "option_ticks": {},
                "last_event_time": "2026-04-24T15:30:30Z",
            }
        )
    )
    collector_state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T09:31:00-06:00")))
    collector_state.ingest(
        CollectorEvents.model_validate(_underlying_event("offset-session", "2026-04-24T09:31:00-06:00"))
    )

    selected_state = cached_or_memory_collector_state()

    assert selected_state.summary()["underlying_ticks_count"] == 1
    assert selected_state.last_event_time() == "2026-04-24T09:31:00-06:00"


def test_redis_client_uses_default_timeout_arguments(monkeypatch) -> None:
    calls = []

    class FakeRedis:
        @staticmethod
        def from_url(*args, **kwargs):
            calls.append((args, kwargs))
            return object()

    monkeypatch.setitem(sys.modules, "redis", types.SimpleNamespace(Redis=FakeRedis))

    RedisLatestStateCache("redis://cache.example:6379/0")._client()

    assert calls == [
        (
            ("redis://cache.example:6379/0",),
            {
                "decode_responses": True,
                "socket_connect_timeout": 0.25,
                "socket_timeout": 0.25,
            },
        )
    ]


class StaticLatestStateCache:
    def __init__(self, state):
        self.state = state

    def get(self):
        return self.state

    def set(self, state):
        self.state = state

    def clear(self) -> None:
        self.state = None


def _health_event(event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "collector_id": "local-dev",
        "status": "connected",
        "ibkr_account_mode": "paper",
        "message": "Mock live cycle",
        "event_time": event_time,
        "received_time": event_time,
    }


def _underlying_event(session_id: str, event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "symbol": "SPX",
        "spot": 5200.25,
        "bid": 5199.75,
        "ask": 5200.75,
        "last": 5200.25,
        "mark": 5200.25,
        "event_time": event_time,
        "quote_status": "valid",
    }


def _contract_event(session_id: str, contract_id: str, event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "ibkr_con_id": 900000,
        "symbol": "SPX",
        "expiry": "2026-04-24",
        "right": "call",
        "strike": 5200,
        "multiplier": 100,
        "exchange": "CBOE",
        "currency": "USD",
        "event_time": event_time,
    }


def _option_event(session_id: str, contract_id: str, event_time: str) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "source": "ibkr",
        "session_id": session_id,
        "contract_id": contract_id,
        "bid": 9.9,
        "ask": 10.1,
        "last": 10.0,
        "bid_size": 10,
        "ask_size": 12,
        "volume": 400,
        "open_interest": 2400,
        "ibkr_iv": 0.2,
        "ibkr_delta": 0.51,
        "ibkr_gamma": 0.017,
        "ibkr_vega": 0.9,
        "ibkr_theta": -1.0,
        "event_time": event_time,
        "quote_status": "valid",
    }
