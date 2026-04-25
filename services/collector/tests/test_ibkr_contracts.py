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

import gammascope_collector.ibkr_contracts as ibkr_contracts
from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.ibkr_config import IbkrHealthConfig
from gammascope_collector.ibkr_contracts import (
    IbkrApiUnavailable,
    IbkrBrokerError,
    IbkrContractDiscoveryConfig,
    IbkrContractDiscoveryTimeout,
    OptionContractRequest,
    OptionMetadata,
    ResolvedIbkrContract,
    _create_real_adapter,
    discover_spx_0dte_contracts,
    main,
    select_candidate_metadata,
    select_strikes,
)
from gammascope_collector.publisher import PublishSummary


@dataclass
class FakeDiscoveryAdapter:
    metadata: list[OptionMetadata]
    resolved_contracts: list[ResolvedIbkrContract]
    spot: float | None = None
    connect_error: Exception | None = None
    wait_error: Exception | None = None
    metadata_error: Exception | None = None
    resolve_error: Exception | None = None
    disconnect_error: Exception | None = None
    disconnected: bool = False
    connect_calls: list[tuple[str, int, int]] | None = None
    wait_calls: list[float] | None = None
    spot_calls: list[float] | None = None
    metadata_calls: list[tuple[int, float]] | None = None
    resolve_calls: list[list[OptionContractRequest]] | None = None

    def connect(self, host: str, port: int, client_id: int) -> None:
        self.connect_calls = self.connect_calls or []
        self.connect_calls.append((host, port, client_id))
        if self.connect_error is not None:
            raise self.connect_error

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        self.wait_calls = self.wait_calls or []
        self.wait_calls.append(timeout_seconds)
        if self.wait_error is not None:
            raise self.wait_error
        return {"next_order_id": 1201}

    def resolve_underlying(self, timeout_seconds: float) -> int:
        if self.metadata_error is not None:
            raise self.metadata_error
        return 416904

    def lookup_spot(self, timeout_seconds: float) -> float:
        self.spot_calls = self.spot_calls or []
        self.spot_calls.append(timeout_seconds)
        if self.spot is None:
            raise IbkrContractDiscoveryTimeout("timed out waiting for SPX spot")
        return self.spot

    def option_metadata(self, underlying_con_id: int, timeout_seconds: float) -> list[OptionMetadata]:
        self.metadata_calls = self.metadata_calls or []
        self.metadata_calls.append((underlying_con_id, timeout_seconds))
        if self.metadata_error is not None:
            raise self.metadata_error
        return list(self.metadata)

    def resolve_option_contracts(
        self,
        requests: Iterable[OptionContractRequest],
        timeout_seconds: float,
    ) -> list[ResolvedIbkrContract]:
        self.resolve_calls = self.resolve_calls or []
        request_list = list(requests)
        self.resolve_calls.append(request_list)
        if self.resolve_error is not None:
            raise self.resolve_error
        by_key = {
            (contract.trading_class, contract.expiry, contract.right, contract.strike): contract
            for contract in self.resolved_contracts
        }
        return [
            by_key[(request.trading_class, request.expiry, request.right, request.strike)]
            for request in request_list
            if (request.trading_class, request.expiry, request.right, request.strike) in by_key
        ]

    def disconnect(self) -> None:
        self.disconnected = True
        if self.disconnect_error is not None:
            raise self.disconnect_error


class FakeEWrapper:
    pass


class FakeContract:
    def __init__(self) -> None:
        self.symbol = ""
        self.secType = ""
        self.exchange = ""
        self.currency = ""
        self.lastTradeDateOrContractMonth = ""
        self.strike = 0.0
        self.right = ""
        self.multiplier = ""
        self.tradingClass = ""
        self.conId = 0


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

    def reqContractDetails(self, req_id: int, contract: object) -> None:
        self.requests.append(("reqContractDetails", req_id, contract))

    def reqSecDefOptParams(
        self,
        req_id: int,
        underlying_symbol: str,
        fut_fop_exchange: str,
        underlying_sec_type: str,
        underlying_con_id: int,
    ) -> None:
        self.requests.append(
            ("reqSecDefOptParams", req_id, underlying_symbol, fut_fop_exchange, underlying_sec_type, underlying_con_id)
        )

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


def discovery_config(**overrides: object) -> IbkrContractDiscoveryConfig:
    base = IbkrContractDiscoveryConfig(
        ibkr=IbkrHealthConfig(
            host="127.0.0.1",
            port=4002,
            client_id=13,
            collector_id="local-test",
            account_mode="paper",
            api_base="http://testserver",
            timeout_seconds=0.5,
        ),
        expiry=date(2026, 4, 24),
        spot=5202.0,
        strike_window_points=10.0,
        max_strikes=None,
        session_id="test-session",
    )
    return base.with_overrides(**overrides)


def spxw_metadata() -> OptionMetadata:
    return OptionMetadata(
        trading_class="SPXW",
        exchange="SMART",
        multiplier="100",
        expirations=frozenset({"20260424", "20260427"}),
        strikes=frozenset({5185.0, 5195.0, 5200.0, 5205.0, 5210.0, 5220.0}),
    )


def spx_metadata() -> OptionMetadata:
    return OptionMetadata(
        trading_class="SPX",
        exchange="SMART",
        multiplier="100",
        expirations=frozenset({"20260424"}),
        strikes=frozenset({5190.0, 5200.0, 5210.0}),
    )


def resolved_pair(trading_class: str, strike: float, con_id_base: int) -> list[ResolvedIbkrContract]:
    return [
        ResolvedIbkrContract(
            ibkr_con_id=con_id_base,
            trading_class=trading_class,
            expiry="20260424",
            right="call",
            strike=strike,
            exchange="CBOE",
            currency="USD",
            multiplier=100.0,
        ),
        ResolvedIbkrContract(
            ibkr_con_id=con_id_base + 1,
            trading_class=trading_class,
            expiry="20260424",
            right="put",
            strike=strike,
            exchange="CBOE",
            currency="USD",
            multiplier=100.0,
        ),
    ]


def test_select_strikes_filters_window_and_keeps_nearest_to_spot() -> None:
    strikes = select_strikes(
        [5175.0, 5195.0, 5200.0, 5205.0, 5210.0, 5220.0],
        spot=5202.0,
        strike_window_points=10.0,
        max_strikes=3,
    )

    assert strikes == [5195.0, 5200.0, 5205.0]


def test_select_candidate_metadata_prefers_spxw_for_same_expiry_and_falls_back_to_spx() -> None:
    assert select_candidate_metadata([spx_metadata(), spxw_metadata()], "20260424").trading_class == "SPXW"
    assert (
        select_candidate_metadata(
            [
                spx_metadata(),
                OptionMetadata(
                    trading_class="SPXW",
                    exchange="SMART",
                    multiplier="100",
                    expirations=frozenset({"20260427"}),
                    strikes=frozenset({5200.0}),
                ),
            ],
            "20260424",
        ).trading_class
        == "SPX"
    )


def test_select_candidate_metadata_merges_same_expiry_spxw_callbacks() -> None:
    selected = select_candidate_metadata(
        [
            OptionMetadata(
                trading_class="SPXW",
                exchange="SMART",
                multiplier="100",
                expirations=frozenset({"20260424"}),
                strikes=frozenset({5200.0, 5210.0}),
            ),
            spx_metadata(),
            OptionMetadata(
                trading_class="SPXW",
                exchange="CBOE",
                multiplier="100",
                expirations=frozenset({"20260424", "20260425"}),
                strikes=frozenset({5190.0, 5200.0}),
            ),
        ],
        "20260424",
    )

    assert selected == OptionMetadata(
        trading_class="SPXW",
        exchange="CBOE",
        multiplier="100",
        expirations=frozenset({"20260424", "20260425"}),
        strikes=frozenset({5190.0, 5200.0, 5210.0}),
    )


def test_discover_contracts_uses_spot_override_prefers_spxw_and_validates_events() -> None:
    adapter = FakeDiscoveryAdapter(
        metadata=[spx_metadata(), spxw_metadata()],
        resolved_contracts=resolved_pair("SPXW", 5200.0, 1001)
        + resolved_pair("SPXW", 5205.0, 1003)
        + resolved_pair("SPX", 5200.0, 2001),
        spot=1.0,
    )

    result = discover_spx_0dte_contracts(
        discovery_config(max_strikes=2),
        adapter_factory=lambda: adapter,
    )

    assert result.session_id == "test-session"
    assert result.target_expiry == "2026-04-24"
    assert result.spot == 5202.0
    assert len(result.events) == 4
    assert adapter.spot_calls is None
    assert {request.trading_class for request in adapter.resolve_calls[0]} == {"SPXW"}
    assert [request.strike for request in adapter.resolve_calls[0]] == [5200.0, 5200.0, 5205.0, 5205.0]
    assert len({event["contract_id"] for event in result.events}) == 4
    for event in result.events:
        CollectorEvents.model_validate(event)
        assert event["symbol"] == "SPX"
        assert event["expiry"] == "2026-04-24"


def test_discover_contracts_returns_empty_result_when_no_same_expiry_metadata() -> None:
    adapter = FakeDiscoveryAdapter(
        metadata=[
            OptionMetadata(
                trading_class="SPXW",
                exchange="SMART",
                multiplier="100",
                expirations=frozenset({"20260427"}),
                strikes=frozenset({5200.0}),
            )
        ],
        resolved_contracts=[],
    )

    result = discover_spx_0dte_contracts(discovery_config(), adapter_factory=lambda: adapter)

    assert result.events == []
    assert result.contracts_count == 0
    assert adapter.resolve_calls is None
    assert adapter.disconnected is True


def test_discover_contracts_disconnects_and_preserves_primary_exception_when_adapter_fails() -> None:
    adapter = FakeDiscoveryAdapter(
        metadata=[spxw_metadata()],
        resolved_contracts=[],
        resolve_error=IbkrContractDiscoveryTimeout("timed out resolving option contracts"),
        disconnect_error=RuntimeError("disconnect failed"),
    )

    with pytest.raises(IbkrContractDiscoveryTimeout, match="timed out resolving option contracts") as exc_info:
        discover_spx_0dte_contracts(discovery_config(), adapter_factory=lambda: adapter)

    assert adapter.disconnected is True
    assert any("disconnect failed" in note for note in getattr(exc_info.value, "__notes__", []))


def test_cli_prints_discovery_json_without_publish_and_accepts_pnpm_separator(capsys: pytest.CaptureFixture[str]) -> None:
    adapter = FakeDiscoveryAdapter(
        metadata=[spxw_metadata()],
        resolved_contracts=resolved_pair("SPXW", 5200.0, 1001),
    )

    main(
        [
            "--",
            "--api",
            "http://testserver",
            "--expiry",
            "2026-04-24",
            "--spot",
            "5202",
            "--max-strikes",
            "1",
        ],
        adapter_factory=lambda: adapter,
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["session_id"]
    assert payload["symbol"] == "SPX"
    assert payload["target_expiry"] == "2026-04-24"
    assert payload["spot"] == 5202.0
    assert payload["contracts_count"] == 2
    assert len(payload["events"]) == 2
    for event in payload["events"]:
        CollectorEvents.model_validate(event)


def test_cli_publish_mode_publishes_zero_events_and_prints_augmented_summary(
    capsys: pytest.CaptureFixture[str],
) -> None:
    adapter = FakeDiscoveryAdapter(metadata=[], resolved_contracts=[])
    captured_events: list[dict[str, object]] = []

    def publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=[],
        )

    main(
        ["--publish", "--api", "http://testserver", "--expiry", "2026-04-24", "--spot", "5202"],
        adapter_factory=lambda: adapter,
        publish=publish,
    )

    summary = json.loads(capsys.readouterr().out)
    assert captured_events == []
    assert summary["accepted_count"] == 0
    assert summary["event_types"] == []
    assert summary["contracts_count"] == 0
    assert summary["target_expiry"] == "2026-04-24"
    assert summary["session_id"]


def test_cli_handles_missing_ibapi_as_error_json(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    def raise_unavailable() -> object:
        raise IbkrApiUnavailable("Install ibapi")

    monkeypatch.setattr(ibkr_contracts, "_create_real_adapter", raise_unavailable)

    with pytest.raises(SystemExit) as exc_info:
        main(["--expiry", "2026-04-24", "--spot", "5202"])

    payload = json.loads(capsys.readouterr().out)
    assert exc_info.value.code == 1
    assert payload["status"] == "error"
    assert "ibapi" in payload["message"]


def test_cli_handles_discovery_timeout_as_error_json(capsys: pytest.CaptureFixture[str]) -> None:
    adapter = FakeDiscoveryAdapter(
        metadata=[],
        resolved_contracts=[],
        wait_error=IbkrContractDiscoveryTimeout("timed out waiting for nextValidId"),
    )

    with pytest.raises(SystemExit) as exc_info:
        main(["--expiry", "2026-04-24", "--spot", "5202"], adapter_factory=lambda: adapter)

    payload = json.loads(capsys.readouterr().out)
    assert exc_info.value.code == 1
    assert payload["status"] == "error"
    assert "timed out waiting for nextValidId" in payload["message"]
    assert adapter.disconnected is True


def test_create_real_adapter_raises_unavailable_when_importer_cannot_load_ibapi() -> None:
    def importer(name: str, *_args: object, **_kwargs: object) -> object:
        if name.startswith("ibapi"):
            raise ImportError("no module named ibapi")
        return __import__(name)

    with pytest.raises(IbkrApiUnavailable, match="ibapi"):
        _create_real_adapter(importer=importer)


def test_real_adapter_collects_callbacks_for_ready_metadata_contracts_and_spot() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)
    client = FakeEClient.instances[-1]

    client.wrapper.nextValidId(1201)
    assert adapter.wait_until_ready(0.5)["next_order_id"] == 1201

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.resolve_underlying, 0.5)
        underlying_req_id = _wait_for_request(client, "reqContractDetails")[1]
        underlying_contract = SimpleNamespace(conId=416904, symbol="SPX", exchange="CBOE", currency="USD")
        client.wrapper.contractDetails(underlying_req_id, SimpleNamespace(contract=underlying_contract))
        client.wrapper.contractDetailsEnd(underlying_req_id)
        assert future.result() == 416904

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.option_metadata, 416904, 0.5)
        metadata_req_id = _wait_for_request(client, "reqSecDefOptParams")[1]
        client.wrapper.securityDefinitionOptionParameter(
            metadata_req_id,
            "SMART",
            416904,
            "SPXW",
            "100",
            {"20260424"},
            {5200.0},
        )
        client.wrapper.securityDefinitionOptionParameterEnd(metadata_req_id)
        assert future.result() == [
            OptionMetadata(
                trading_class="SPXW",
                exchange="SMART",
                multiplier="100",
                expirations=frozenset({"20260424"}),
                strikes=frozenset({5200.0}),
            )
        ]

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.lookup_spot, 0.5)
        market_data_req_id = _wait_for_request(client, "reqMktData")[1]
        client.wrapper.tickPrice(market_data_req_id, 1, 5201.0, None)
        client.wrapper.tickPrice(market_data_req_id, 2, 5201.5, None)
        client.wrapper.tickPrice(market_data_req_id, 4, 5201.25, None)
        assert future.result() == 5201.25

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            adapter.resolve_option_contracts,
            [OptionContractRequest(trading_class="SPXW", expiry="20260424", right="call", strike=5200.0)],
            0.5,
        )
        contract_req_id = _wait_for_nth_request(client, "reqContractDetails", 2)[1]
        option_contract = SimpleNamespace(
            conId=1001,
            tradingClass="SPXW",
            lastTradeDateOrContractMonth="20260424",
            right="C",
            strike=5200.0,
            exchange="CBOE",
            currency="USD",
            multiplier="100",
        )
        client.wrapper.contractDetails(contract_req_id, SimpleNamespace(contract=option_contract))
        client.wrapper.contractDetailsEnd(contract_req_id)
        assert future.result() == [
            ResolvedIbkrContract(
                ibkr_con_id=1001,
                trading_class="SPXW",
                expiry="20260424",
                right="call",
                strike=5200.0,
                exchange="CBOE",
                currency="USD",
                multiplier=100.0,
            )
        ]
    adapter.disconnect()


def test_real_adapter_connection_error_callback_fails_pending_wait_promptly() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    start = time.monotonic()
    adapter._client.error(-1, 502, "Could not connect to TWS")

    with pytest.raises(OSError, match="502.*Could not connect to TWS"):
        adapter.wait_until_ready(0.5)

    assert time.monotonic() - start < 0.2
    adapter.disconnect()


def test_real_adapter_lookup_spot_fails_on_request_scoped_market_data_error() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.lookup_spot, 0.5)
        market_data_req_id = _wait_for_request(FakeEClient.instances[-1], "reqMktData")[1]
        FakeEClient.instances[-1].wrapper.error(market_data_req_id, 200, "No security definition has been found")

        with pytest.raises(IbkrBrokerError, match="200.*No security definition"):
            future.result()

    adapter.disconnect()


def test_real_adapter_lookup_spot_fails_on_connection_closed() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.lookup_spot, 0.5)
        _wait_for_request(FakeEClient.instances[-1], "reqMktData")
        FakeEClient.instances[-1].wrapper.connectionClosed()

        with pytest.raises(IbkrBrokerError, match="connection closed"):
            future.result()

    adapter.disconnect()


def test_real_adapter_lookup_spot_uses_bid_ask_midpoint_without_last() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.lookup_spot, 0.5)
        market_data_req_id = _wait_for_request(FakeEClient.instances[-1], "reqMktData")[1]
        FakeEClient.instances[-1].wrapper.tickPrice(market_data_req_id, 1, 5201.0, None)
        FakeEClient.instances[-1].wrapper.tickPrice(market_data_req_id, 2, 5201.5, None)

        assert future.result() == 5201.25

    adapter.disconnect()


def test_real_adapter_lookup_spot_snapshot_end_without_price_has_precise_error() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.lookup_spot, 0.5)
        market_data_req_id = _wait_for_request(FakeEClient.instances[-1], "reqMktData")[1]
        FakeEClient.instances[-1].wrapper.tickSnapshotEnd(market_data_req_id)

        with pytest.raises(IbkrContractDiscoveryTimeout, match="snapshot ended without usable SPX spot"):
            future.result()

    adapter.disconnect()


def test_real_adapter_informational_error_does_not_fail_unrelated_contract_details_wait() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)
    client = FakeEClient.instances[-1]

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(adapter.resolve_underlying, 0.5)
        underlying_req_id = _wait_for_request(client, "reqContractDetails")[1]
        client.wrapper.error(-1, 2104, "Market data farm connection is OK")
        assert future.done() is False

        underlying_contract = SimpleNamespace(conId=416904, symbol="SPX", exchange="CBOE", currency="USD")
        client.wrapper.contractDetails(underlying_req_id, SimpleNamespace(contract=underlying_contract))
        client.wrapper.contractDetailsEnd(underlying_req_id)
        assert future.result() == 416904

    adapter.disconnect()


def test_real_adapter_resolve_option_contracts_deduplicates_same_con_id() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)
    client = FakeEClient.instances[-1]

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            adapter.resolve_option_contracts,
            [OptionContractRequest(trading_class="SPXW", expiry="20260424", right="call", strike=5200.0)],
            0.5,
        )
        contract_req_id = _wait_for_request(client, "reqContractDetails")[1]
        option_contract = _option_contract_detail(con_id=1001, strike=5200.0)
        client.wrapper.contractDetails(contract_req_id, SimpleNamespace(contract=option_contract))
        client.wrapper.contractDetails(contract_req_id, SimpleNamespace(contract=option_contract))
        client.wrapper.contractDetailsEnd(contract_req_id)

        assert future.result() == [
            ResolvedIbkrContract(
                ibkr_con_id=1001,
                trading_class="SPXW",
                expiry="20260424",
                right="call",
                strike=5200.0,
                exchange="CBOE",
                currency="USD",
                multiplier=100.0,
            )
        ]

    adapter.disconnect()


def test_real_adapter_resolve_option_contracts_rejects_ambiguous_con_ids() -> None:
    FakeEClient.instances.clear()
    adapter = _create_real_adapter(importer=fake_ibapi_importer)
    adapter.connect("127.0.0.1", 4002, 13)
    client = FakeEClient.instances[-1]

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            adapter.resolve_option_contracts,
            [OptionContractRequest(trading_class="SPXW", expiry="20260424", right="call", strike=5200.0)],
            0.5,
        )
        contract_req_id = _wait_for_request(client, "reqContractDetails")[1]
        client.wrapper.contractDetails(contract_req_id, SimpleNamespace(contract=_option_contract_detail(con_id=1001)))
        client.wrapper.contractDetails(contract_req_id, SimpleNamespace(contract=_option_contract_detail(con_id=2002)))
        client.wrapper.contractDetailsEnd(contract_req_id)

        with pytest.raises(IbkrBrokerError, match="ambiguous.*1001.*2002"):
            future.result()

    adapter.disconnect()


def _wait_for_request(client: FakeEClient, name: str) -> tuple[object, ...]:
    return _wait_for_nth_request(client, name, 1)


def _wait_for_nth_request(client: FakeEClient, name: str, count: int) -> tuple[object, ...]:
    deadline = time.monotonic() + 0.5
    while time.monotonic() < deadline:
        matches = [request for request in client.requests if request[0] == name]
        if len(matches) >= count:
            return matches[count - 1]
        time.sleep(0.01)
    raise AssertionError(f"timed out waiting for {count} {name} request(s)")


def _option_contract_detail(*, con_id: int, strike: float = 5200.0) -> SimpleNamespace:
    return SimpleNamespace(
        conId=con_id,
        tradingClass="SPXW",
        lastTradeDateOrContractMonth="20260424",
        right="C",
        strike=strike,
        exchange="CBOE",
        currency="USD",
        multiplier="100",
    )
