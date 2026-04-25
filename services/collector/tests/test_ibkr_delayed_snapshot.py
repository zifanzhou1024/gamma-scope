from __future__ import annotations

from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
import json
from types import SimpleNamespace
import threading
import time

import pytest

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.events import contract_discovered_event
from gammascope_collector.ibkr_config import IbkrHealthConfig
from gammascope_collector.ibkr_contracts import ContractDiscoveryResult, IbkrContractDiscoveryConfig
from gammascope_collector.ibkr_delayed_snapshot import (
    DelayedMarketDataQuote,
    DelayedSnapshotConfig,
    IbkrDelayedMarketDataTimeout,
    _create_real_adapter,
    collect_delayed_snapshot,
    main,
)
from gammascope_collector.publisher import PublishSummary


def ibkr_config() -> IbkrHealthConfig:
    return IbkrHealthConfig(
        host="127.0.0.1",
        port=4002,
        client_id=21,
        collector_id="local-delayed",
        account_mode="paper",
        api_base="http://testserver",
        timeout_seconds=0.5,
    )


def snapshot_config(**overrides: object) -> DelayedSnapshotConfig:
    config = DelayedSnapshotConfig(
        ibkr=ibkr_config(),
        expiry=date(2026, 4, 27),
        spot=7050.0,
        strike_window_points=10.0,
        max_strikes=1,
        session_id="delayed-session",
    )
    return config.with_overrides(**overrides)


def contract_event(right: str, con_id: int) -> dict[str, object]:
    return contract_discovered_event(
        session_id="delayed-session",
        ibkr_con_id=con_id,
        symbol="SPX",
        expiry="2026-04-27",
        right=right,
        strike=7050.0,
    )


def discovery_result(events: list[dict[str, object]]) -> ContractDiscoveryResult:
    return ContractDiscoveryResult(
        session_id="delayed-session",
        symbol="SPX",
        target_expiry="2026-04-27",
        spot=7050.0,
        events=events,
    )


@dataclass
class FakeDelayedAdapter:
    underlying_quote: DelayedMarketDataQuote | None = None
    option_quotes: dict[int, DelayedMarketDataQuote] | None = None
    wait_error: Exception | None = None
    option_error: Exception | None = None
    disconnected: bool = False
    connect_calls: list[tuple[str, int, int]] | None = None
    delayed_calls: int = 0
    underlying_calls: list[float] | None = None
    option_calls: list[list[dict[str, object]]] | None = None

    def connect(self, host: str, port: int, client_id: int) -> None:
        self.connect_calls = self.connect_calls or []
        self.connect_calls.append((host, port, client_id))

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        if self.wait_error is not None:
            raise self.wait_error
        return {"next_order_id": 1201}

    def request_delayed_market_data(self) -> None:
        self.delayed_calls += 1

    def snapshot_underlying(self, timeout_seconds: float) -> DelayedMarketDataQuote:
        self.underlying_calls = self.underlying_calls or []
        self.underlying_calls.append(timeout_seconds)
        if self.underlying_quote is None:
            raise IbkrDelayedMarketDataTimeout("missing underlying quote")
        return self.underlying_quote

    def snapshot_options(
        self,
        contracts: Iterable[dict[str, object]],
        timeout_seconds: float,
    ) -> dict[str, DelayedMarketDataQuote]:
        self.option_calls = self.option_calls or []
        contract_list = list(contracts)
        self.option_calls.append(contract_list)
        if self.option_error is not None:
            raise self.option_error
        quotes = self.option_quotes or {}
        return {str(contract["contract_id"]): quotes[int(contract["ibkr_con_id"])] for contract in contract_list}

    def disconnect(self) -> None:
        self.disconnected = True


class FakeEWrapper:
    pass


class FakeContract:
    def __init__(self) -> None:
        self.conId = 0
        self.symbol = ""
        self.secType = ""
        self.exchange = ""
        self.currency = ""
        self.lastTradeDateOrContractMonth = ""
        self.strike = 0.0
        self.right = ""
        self.multiplier = ""
        self.tradingClass = ""


class FakeEClient:
    instances: list["FakeEClient"] = []

    def __init__(self, wrapper: object) -> None:
        self.wrapper = wrapper
        self.stop_requested = threading.Event()
        self.requests: list[tuple[object, ...]] = []
        FakeEClient.instances.append(self)

    def connect(self, _host: str, _port: int, _client_id: int) -> bool:
        return True

    def run(self) -> None:
        self.stop_requested.wait(1)

    def disconnect(self) -> None:
        self.stop_requested.set()

    def reqMarketDataType(self, market_data_type: int) -> None:
        self.requests.append(("reqMarketDataType", market_data_type))

    def reqMktData(
        self,
        req_id: int,
        contract: object,
        generic_tick_list: str,
        snapshot: bool,
        regulatory_snapshot: bool,
        mkt_data_options: list[object],
    ) -> None:
        self.requests.append(
            ("reqMktData", req_id, contract, generic_tick_list, snapshot, regulatory_snapshot, mkt_data_options)
        )

    def cancelMktData(self, req_id: int) -> None:
        self.requests.append(("cancelMktData", req_id))


def fake_ibapi_importer(name: str, *_args: object, **_kwargs: object) -> object:
    if name == "ibapi.client":
        return SimpleNamespace(EClient=FakeEClient)
    if name == "ibapi.contract":
        return SimpleNamespace(Contract=FakeContract)
    if name == "ibapi.wrapper":
        return SimpleNamespace(EWrapper=FakeEWrapper)
    return __import__(name)


def test_collect_delayed_snapshot_with_spot_override_builds_contract_and_option_events() -> None:
    call_event = contract_event("call", 867905902)
    put_event = contract_event("put", 867906222)
    adapter = FakeDelayedAdapter(
        option_quotes={
            867905902: DelayedMarketDataQuote(
                bid=26.4,
                ask=27.2,
                last=26.8,
                bid_size=11,
                ask_size=13,
                volume=420,
                open_interest=None,
                ibkr_iv=0.42,
                ibkr_delta=0.52,
                ibkr_gamma=0.0012,
                ibkr_vega=0.84,
                ibkr_theta=-1.8,
            ),
            867906222: DelayedMarketDataQuote(
                bid=25.8,
                ask=26.5,
                last=26.1,
                bid_size=10,
                ask_size=12,
                volume=390,
                open_interest=None,
                ibkr_iv=0.43,
                ibkr_delta=-0.48,
                ibkr_gamma=0.0011,
                ibkr_vega=0.81,
                ibkr_theta=-1.7,
            ),
        }
    )
    captured_discovery_configs: list[IbkrContractDiscoveryConfig] = []

    def discover(config: IbkrContractDiscoveryConfig) -> ContractDiscoveryResult:
        captured_discovery_configs.append(config)
        return discovery_result([call_event, put_event])

    result = collect_delayed_snapshot(
        snapshot_config(),
        discovery_runner=discover,
        adapter_factory=lambda: adapter,
    )

    assert captured_discovery_configs[0].spot == 7050.0
    assert captured_discovery_configs[0].session_id == "delayed-session"
    assert adapter.underlying_calls is None
    assert adapter.delayed_calls == 1
    assert result.contracts_count == 2
    assert result.option_ticks_count == 2
    assert [event.get("status") for event in result.events if "collector_id" in event] == ["degraded"]
    assert len([event for event in result.events if "ibkr_con_id" in event]) == 2
    option_events = [event for event in result.events if "ibkr_iv" in event]
    assert {event["contract_id"] for event in option_events} == {
        "SPX-2026-04-27-C-7050",
        "SPX-2026-04-27-P-7050",
    }
    assert option_events[0]["quote_status"] == "valid"
    for event in result.events:
        CollectorEvents.model_validate(event)


def test_collect_delayed_snapshot_without_spot_uses_delayed_underlying_before_discovery() -> None:
    underlying_adapter = FakeDelayedAdapter(
        underlying_quote=DelayedMarketDataQuote(bid=7049.5, ask=7050.5, last=None)
    )
    option_adapter = FakeDelayedAdapter(option_quotes={})
    adapters = iter([underlying_adapter, option_adapter])
    captured_spots: list[float | None] = []

    def discover(config: IbkrContractDiscoveryConfig) -> ContractDiscoveryResult:
        captured_spots.append(config.spot)
        return discovery_result([])

    result = collect_delayed_snapshot(
        snapshot_config(spot=None),
        discovery_runner=discover,
        adapter_factory=lambda: next(adapters),
    )

    assert captured_spots == [7050.0]
    assert underlying_adapter.delayed_calls == 1
    assert underlying_adapter.disconnected is True
    assert option_adapter.connect_calls is None
    assert result.underlying_tick["mark"] == 7050.0
    assert result.contracts_count == 0
    assert result.option_ticks_count == 0


def test_cli_publish_mode_publishes_all_snapshot_events_and_prints_summary(
    capsys: pytest.CaptureFixture[str],
) -> None:
    adapter = FakeDelayedAdapter(
        option_quotes={
            867905902: DelayedMarketDataQuote(bid=26.4, ask=27.2, last=26.8),
        }
    )
    captured_events: list[dict[str, object]] = []

    def discover(_config: IbkrContractDiscoveryConfig) -> ContractDiscoveryResult:
        return discovery_result([contract_event("call", 867905902)])

    def publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=[
                "CollectorHealth" if "collector_id" in event else
                "ContractDiscovered" if "ibkr_con_id" in event else
                "UnderlyingTick" if "spot" in event else
                "OptionTick"
                for event in captured_events
            ],
        )

    main(
        [
            "--publish",
            "--api",
            "http://testserver",
            "--expiry",
            "2026-04-27",
            "--spot",
            "7050",
            "--session-id",
            "delayed-session",
        ],
        discovery_runner=discover,
        adapter_factory=lambda: adapter,
        publish=publish,
    )

    summary = json.loads(capsys.readouterr().out)
    assert summary["accepted_count"] == 4
    assert summary["contracts_count"] == 1
    assert summary["option_ticks_count"] == 1
    assert summary["market_data_type"] == "delayed"
    assert summary["event_types"] == ["CollectorHealth", "UnderlyingTick", "ContractDiscovered", "OptionTick"]
    assert len(captured_events) == 4


def test_real_adapter_requests_delayed_market_data_and_maps_delayed_underlying_ticks() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 21)
    client = FakeEClient.instances[-1]

    client.wrapper.nextValidId(1201)
    adapter.wait_until_ready(0.5)
    adapter.request_delayed_market_data()

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.snapshot_underlying, 0.5)
        request = _wait_for_request(client, "reqMktData")
        req_id = int(request[1])
        contract = request[2]
        client.wrapper.tickPrice(req_id, 66, 7049.5, None)
        client.wrapper.tickPrice(req_id, 67, 7050.5, None)
        client.wrapper.tickSize(req_id, 69, 5)
        client.wrapper.tickSize(req_id, 70, 6)
        client.wrapper.tickSnapshotEnd(req_id)
        quote = future.result()

    assert ("reqMarketDataType", 3) in client.requests
    assert contract.symbol == "SPX"
    assert contract.secType == "IND"
    assert quote.bid == 7049.5
    assert quote.ask == 7050.5
    assert quote.spot() == 7050.0
    adapter.disconnect()


def test_real_adapter_maps_delayed_option_prices_sizes_and_greeks() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 21)
    client = FakeEClient.instances[-1]
    client.wrapper.nextValidId(1201)
    adapter.wait_until_ready(0.5)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.snapshot_options, [contract_event("call", 867905902)], 0.5)
        request = _wait_for_request(client, "reqMktData")
        req_id = int(request[1])
        contract = request[2]
        client.wrapper.tickOptionComputation(req_id, 83, 0, None, None, None, None, None, None, None, None)
        client.wrapper.tickPrice(req_id, 66, 26.4, None)
        client.wrapper.tickPrice(req_id, 67, 27.2, None)
        client.wrapper.tickPrice(req_id, 68, 26.8, None)
        client.wrapper.tickSize(req_id, 69, 11)
        client.wrapper.tickSize(req_id, 70, 13)
        client.wrapper.tickSize(req_id, 74, 420)
        client.wrapper.tickOptionComputation(req_id, 83, 0, 0.42, 0.52, 26.8, 0.0, 0.0012, 0.84, -1.8, 7050.0)
        client.wrapper.tickSnapshotEnd(req_id)
        quotes = future.result()

    quote = quotes["SPX-2026-04-27-C-7050"]
    assert contract.conId == 867905902
    assert contract.secType == "OPT"
    assert quote.bid == 26.4
    assert quote.ask == 27.2
    assert quote.volume == 420
    assert quote.ibkr_iv == 0.42
    assert quote.ibkr_delta == 0.52
    assert quote.ibkr_gamma == 0.0012
    assert quote.ibkr_vega == 0.84
    assert quote.ibkr_theta == -1.8
    adapter.disconnect()


def test_real_adapter_request_scoped_error_fails_matching_option_snapshot() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 21)
    client = FakeEClient.instances[-1]
    client.wrapper.nextValidId(1201)
    adapter.wait_until_ready(0.5)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.snapshot_options, [contract_event("call", 867905902)], 0.5)
        req_id = int(_wait_for_request(client, "reqMktData")[1])
        client.wrapper.error(req_id, 354, "Requested market data is not subscribed")
        with pytest.raises(OSError, match="354.*not subscribed"):
            future.result()

    adapter.disconnect()


@pytest.mark.parametrize(
    ("code", "message"),
    [
        (10167, "Requested market data is not subscribed. Displaying delayed market data."),
        (10090, "Part of requested market data is not subscribed. Delayed market data is available."),
    ],
)
def test_real_adapter_delayed_notice_does_not_fail_matching_option_snapshot(code: int, message: str) -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 21)
    client = FakeEClient.instances[-1]
    client.wrapper.nextValidId(1201)
    adapter.wait_until_ready(0.5)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.snapshot_options, [contract_event("call", 867905902)], 0.5)
        req_id = int(_wait_for_request(client, "reqMktData")[1])
        client.wrapper.error(req_id, code, message)
        client.wrapper.tickPrice(req_id, 66, 26.4, None)
        client.wrapper.tickPrice(req_id, 67, 27.2, None)
        client.wrapper.tickSnapshotEnd(req_id)
        quotes = future.result()

    assert quotes["SPX-2026-04-27-C-7050"].bid == 26.4
    assert quotes["SPX-2026-04-27-C-7050"].ask == 27.2
    adapter.disconnect()


def _wait_for_request(client: FakeEClient, name: str) -> tuple[object, ...]:
    deadline = time.monotonic() + 0.5
    while time.monotonic() < deadline:
        for request in client.requests:
            if request[0] == name:
                return request
        time.sleep(0.01)
    raise AssertionError(f"timed out waiting for {name}")
