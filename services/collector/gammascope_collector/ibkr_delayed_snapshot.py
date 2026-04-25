from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time as datetime_time
from math import isfinite
from typing import Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo

from gammascope_collector.events import health_event, option_tick_event, underlying_tick_event
from gammascope_collector.ibkr_config import IbkrHealthConfig, ibkr_health_config_from_env
from gammascope_collector.ibkr_contracts import (
    ContractDiscoveryResult,
    IbkrApiUnavailable,
    IbkrBrokerError,
    IbkrContractDiscoveryConfig,
    discover_spx_0dte_contracts,
)
from gammascope_collector.publisher import PublishSummary, publish_events

DELAYED_MARKET_DATA_TYPE = 3
DELAYED_FROZEN_MARKET_DATA_TYPE = 4
_MARKET_DATA_TYPE_NAMES = {
    DELAYED_MARKET_DATA_TYPE: "delayed",
    DELAYED_FROZEN_MARKET_DATA_TYPE: "delayed_frozen",
}
_EASTERN_TIME = ZoneInfo("America/New_York")
_REGULAR_SESSION_START = datetime_time(hour=9, minute=30)
_REGULAR_SESSION_END = datetime_time(hour=16, minute=15)
_INFORMATIONAL_ERROR_CODES = {10090, 10167, 10168, 2104, 2106, 2108, 2158}
_NO_DATA_QUOTE_ERROR_CODES = {354, 10197}


class IbkrDelayedMarketDataTimeout(TimeoutError):
    pass


@dataclass(frozen=True)
class DelayedMarketDataQuote:
    bid: float | None = None
    ask: float | None = None
    last: float | None = None
    bid_size: float | None = None
    ask_size: float | None = None
    volume: float | None = None
    open_interest: float | None = None
    ibkr_iv: float | None = None
    ibkr_delta: float | None = None
    ibkr_gamma: float | None = None
    ibkr_vega: float | None = None
    ibkr_theta: float | None = None

    def spot(self) -> float | None:
        if self.last is not None:
            return self.last
        if self.bid is not None and self.ask is not None:
            return (self.bid + self.ask) / 2
        return None


@dataclass(frozen=True)
class DelayedSnapshotConfig:
    ibkr: IbkrHealthConfig
    expiry: date
    spot: float | None = None
    strike_window_points: float = 100.0
    max_strikes: int | None = None
    session_id: str = ""
    symbol: str = "SPX"
    market_data_type: int = DELAYED_MARKET_DATA_TYPE

    def with_overrides(self, **overrides: object) -> DelayedSnapshotConfig:
        return replace(self, **overrides)


@dataclass(frozen=True)
class DelayedSnapshotResult:
    session_id: str
    symbol: str
    target_expiry: str
    spot: float
    underlying_tick: dict[str, object]
    events: list[dict[str, object]]
    contracts_count: int
    option_ticks_count: int
    market_data_type: str
    market_data_type_id: int

    def as_dict(self) -> dict[str, object]:
        return {
            "session_id": self.session_id,
            "symbol": self.symbol,
            "target_expiry": self.target_expiry,
            "spot": self.spot,
            "contracts_count": self.contracts_count,
            "option_ticks_count": self.option_ticks_count,
            "market_data_type": self.market_data_type,
            "market_data_type_id": self.market_data_type_id,
            "events": self.events,
        }


class IbkrDelayedSnapshotAdapter(Protocol):
    def connect(self, host: str, port: int, client_id: int) -> None:
        ...

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        ...

    def request_market_data_type(self, market_data_type: int) -> None:
        ...

    def snapshot_underlying(self, timeout_seconds: float) -> DelayedMarketDataQuote:
        ...

    def snapshot_options(
        self,
        contracts: Iterable[dict[str, object]],
        timeout_seconds: float,
    ) -> dict[str, DelayedMarketDataQuote]:
        ...

    def disconnect(self) -> None:
        ...


AdapterFactory = Callable[[], IbkrDelayedSnapshotAdapter]
DiscoveryRunner = Callable[[IbkrContractDiscoveryConfig], ContractDiscoveryResult]
Importer = Callable[..., object]
Publish = Callable[..., PublishSummary | dict[str, object]]


def collect_delayed_snapshot(
    config: DelayedSnapshotConfig,
    *,
    discovery_runner: DiscoveryRunner | None = None,
    adapter_factory: AdapterFactory | None = None,
) -> DelayedSnapshotResult:
    session_id = config.session_id or f"ibkr-delayed-spx-{uuid4()}"
    target_expiry = config.expiry.isoformat()
    adapter_maker = adapter_factory or _create_real_adapter

    if config.spot is None:
        underlying_quote = _snapshot_underlying(config.ibkr, adapter_maker, config.market_data_type)
        spot = underlying_quote.spot()
        if spot is None:
            raise IbkrDelayedMarketDataTimeout("IBKR delayed SPX snapshot did not include a usable spot")
    else:
        spot = float(config.spot)
        underlying_quote = DelayedMarketDataQuote(last=spot)

    discover = discovery_runner or discover_spx_0dte_contracts
    discovery = discover(
        IbkrContractDiscoveryConfig(
            ibkr=config.ibkr,
            expiry=config.expiry,
            spot=spot,
            strike_window_points=config.strike_window_points,
            max_strikes=config.max_strikes,
            session_id=session_id,
            symbol=config.symbol,
        )
    )

    option_quotes: dict[str, DelayedMarketDataQuote] = {}
    if discovery.events:
        option_quotes = _snapshot_options(config.ibkr, adapter_maker, discovery.events, config.market_data_type)

    market_data_type_name = _market_data_type_name(config.market_data_type)
    health = health_event(
        collector_id=config.ibkr.collector_id,
        status="degraded",
        ibkr_account_mode=config.ibkr.account_mode,
        message=f"IBKR {market_data_type_name.replace('_', ' ')} market data snapshot emitted",
    )
    underlying = underlying_tick_event(
        session_id=session_id,
        bid=underlying_quote.bid,
        ask=underlying_quote.ask,
        last=underlying_quote.last if underlying_quote.last is not None else spot,
    )
    option_events = [
        _option_event(session_id=session_id, contract=contract, quote=quote)
        for contract in discovery.events
        if (quote := option_quotes.get(str(contract["contract_id"]))) is not None
    ]
    events = [health, underlying, *discovery.events, *option_events]

    return DelayedSnapshotResult(
        session_id=session_id,
        symbol=config.symbol,
        target_expiry=target_expiry,
        spot=spot,
        underlying_tick=underlying,
        events=events,
        contracts_count=len(discovery.events),
        option_ticks_count=len(option_events),
        market_data_type=market_data_type_name,
        market_data_type_id=config.market_data_type,
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    discovery_runner: DiscoveryRunner | None = None,
    adapter_factory: AdapterFactory | None = None,
    publish: Publish | None = None,
) -> None:
    defaults = ibkr_health_config_from_env()
    parser = argparse.ArgumentParser(description="Publish a one-shot delayed IBKR SPX option snapshot.")
    parser.add_argument("--host", default=defaults.host)
    parser.add_argument("--port", type=int, default=defaults.port)
    parser.add_argument("--client-id", type=int, default=defaults.client_id)
    parser.add_argument("--collector-id", default=defaults.collector_id)
    parser.add_argument("--account-mode", choices=["paper", "live", "unknown"], default=defaults.account_mode)
    parser.add_argument("--api", default=defaults.api_base)
    parser.add_argument("--timeout-seconds", type=float, default=defaults.timeout_seconds)
    parser.add_argument("--expiry", type=_parse_date, default=date.today())
    parser.add_argument("--spot", type=float)
    parser.add_argument("--strike-window-points", type=float, default=100.0)
    parser.add_argument("--max-strikes", type=int)
    parser.add_argument("--session-id")
    parser.add_argument(
        "--market-data-type",
        default="auto",
        choices=["auto", "3", "4", "delayed", "delayed-frozen", "delayed_frozen"],
        help="IBKR market data type: auto, 3/delayed, or 4/delayed-frozen.",
    )
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    ibkr_config = _validated_ibkr_config(
        defaults,
        host=args.host,
        port=args.port,
        client_id=args.client_id,
        collector_id=args.collector_id,
        account_mode=args.account_mode,
        api_base=args.api,
        timeout_seconds=args.timeout_seconds,
    )
    config = DelayedSnapshotConfig(
        ibkr=ibkr_config,
        expiry=args.expiry,
        spot=args.spot,
        strike_window_points=args.strike_window_points,
        max_strikes=args.max_strikes,
        session_id=args.session_id or "",
        market_data_type=_resolve_market_data_type(args.market_data_type),
    )

    try:
        result = collect_delayed_snapshot(
            config,
            discovery_runner=discovery_runner,
            adapter_factory=adapter_factory,
        )
    except IbkrApiUnavailable as exc:
        _print_json({"status": "error", "message": f"IBKR delayed snapshot unavailable: missing ibapi package ({exc})"})
        raise SystemExit(1) from exc
    except (IbkrDelayedMarketDataTimeout, TimeoutError, OSError) as exc:
        _print_json({"status": "error", "message": f"IBKR delayed snapshot failed: {exc}"})
        raise SystemExit(1) from exc

    if args.publish:
        publisher = publish or publish_events
        summary = _summary_dict(publisher(result.events, api_base=ibkr_config.api_base))
        summary.update(
            {
                "contracts_count": result.contracts_count,
                "option_ticks_count": result.option_ticks_count,
                "session_id": result.session_id,
                "target_expiry": result.target_expiry,
                "market_data_type": result.market_data_type,
                "market_data_type_id": result.market_data_type_id,
            }
        )
        _print_json(summary)
        return

    _print_json(result.as_dict())


class _RealIbkrDelayedSnapshotAdapter:
    _THREAD_JOIN_TIMEOUT_SECONDS = 1.0
    _CONNECTION_ERROR_CODES = {326, 502, 504, 507, 1100, 1300}

    def __init__(self, client: object, contract_type: type, ready_event: threading.Event, metadata: dict[str, object]):
        self._client = client
        self._contract_type = contract_type
        self._ready_event = ready_event
        self._metadata = metadata
        self._thread: threading.Thread | None = None
        self._next_req_id = 1

    def connect(self, host: str, port: int, client_id: int) -> None:
        result = self._client.connect(host, port, client_id)
        if result is False:
            raise OSError(f"IBKR API client refused connection to {host}:{port}")
        self._thread = threading.Thread(target=self._client.run, name="ibkr-delayed-api-loop", daemon=True)
        self._thread.start()

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        if not self._ready_event.wait(timeout_seconds):
            raise IbkrDelayedMarketDataTimeout(_timeout_message("nextValidId", timeout_seconds, self._metadata))
        terminal_error = _broker_error_message(self._metadata.get("terminal_error"))
        if terminal_error is not None:
            raise IbkrBrokerError(f"IBKR API broker error {terminal_error}")
        return dict(self._metadata)

    def request_market_data_type(self, market_data_type: int) -> None:
        self._client.reqMarketDataType(market_data_type)

    def snapshot_underlying(self, timeout_seconds: float) -> DelayedMarketDataQuote:
        contract = self._contract()
        contract.symbol = "SPX"
        contract.secType = "IND"
        contract.exchange = "CBOE"
        contract.currency = "USD"
        return self._snapshot_contract(contract, timeout_seconds, label="SPX delayed snapshot")

    def snapshot_options(
        self,
        contracts: Iterable[dict[str, object]],
        timeout_seconds: float,
    ) -> dict[str, DelayedMarketDataQuote]:
        pending_requests: list[tuple[int, dict[str, object], _PendingMarketData]] = []
        try:
            for contract_event in contracts:
                req_id = self._request_id()
                pending = _PendingMarketData()
                pending_requests.append((req_id, contract_event, pending))
                self._client._pending_market_data[req_id] = pending
                self._client.reqMktData(req_id, self._option_contract(contract_event), "", True, False, [])

            deadline = time.monotonic() + timeout_seconds
            quotes: dict[str, DelayedMarketDataQuote] = {}
            for _req_id, contract_event, pending in pending_requests:
                remaining_seconds = max(0.0, deadline - time.monotonic())
                if not pending.event.wait(remaining_seconds):
                    raise IbkrDelayedMarketDataTimeout(
                        _timeout_message(f"{len(pending_requests)} option snapshots", timeout_seconds, self._metadata)
                    )
                if pending.error is not None:
                    raise IbkrBrokerError(f"IBKR API broker error {_broker_error_message(pending.error)}")
                quotes[str(contract_event["contract_id"])] = pending.quote()
            return quotes
        finally:
            for req_id, _contract_event, _pending in pending_requests:
                self._cancel_snapshot(req_id)

    def disconnect(self) -> None:
        try:
            self._client.disconnect()
        finally:
            self._join_thread()

    def _snapshot_contract(self, contract: object, timeout_seconds: float, *, label: str) -> DelayedMarketDataQuote:
        req_id = self._request_id()
        pending = _PendingMarketData()
        self._client._pending_market_data[req_id] = pending
        self._client.reqMktData(req_id, contract, "", True, False, [])
        try:
            if not pending.event.wait(timeout_seconds):
                raise IbkrDelayedMarketDataTimeout(_timeout_message(label, timeout_seconds, self._metadata))
            if pending.error is not None:
                raise IbkrBrokerError(f"IBKR API broker error {_broker_error_message(pending.error)}")
            return pending.quote()
        finally:
            self._cancel_snapshot(req_id)

    def _option_contract(self, contract_event: dict[str, object]) -> object:
        contract = self._contract()
        contract.conId = int(contract_event["ibkr_con_id"])
        contract.symbol = "SPX"
        contract.secType = "OPT"
        contract.exchange = "SMART"
        contract.currency = str(contract_event["currency"])
        contract.lastTradeDateOrContractMonth = str(contract_event["expiry"]).replace("-", "")
        contract.strike = float(contract_event["strike"])
        contract.right = "C" if contract_event["right"] == "call" else "P"
        contract.multiplier = str(int(float(contract_event["multiplier"])))
        return contract

    def _cancel_snapshot(self, req_id: int) -> None:
        cancel = getattr(self._client, "cancelMktData", None)
        if cancel is not None:
            try:
                cancel(req_id)
            except Exception:
                pass
        self._client._pending_market_data.pop(req_id, None)

    def _join_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(self._THREAD_JOIN_TIMEOUT_SECONDS)

    def _request_id(self) -> int:
        req_id = self._next_req_id
        self._next_req_id += 1
        return req_id

    def _contract(self) -> object:
        return self._contract_type()

    @classmethod
    def is_connection_error_code(cls, code: int) -> bool:
        return code in cls._CONNECTION_ERROR_CODES


class _PendingMarketData:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.bid: float | None = None
        self.ask: float | None = None
        self.last: float | None = None
        self.bid_size: float | None = None
        self.ask_size: float | None = None
        self.volume: float | None = None
        self.open_interest: float | None = None
        self.ibkr_iv: float | None = None
        self.ibkr_delta: float | None = None
        self.ibkr_gamma: float | None = None
        self.ibkr_vega: float | None = None
        self.ibkr_theta: float | None = None
        self.market_data_type: int | None = None
        self.error: dict[str, object] | None = None
        self.snapshot_ended = False

    def quote(self) -> DelayedMarketDataQuote:
        return DelayedMarketDataQuote(
            bid=self.bid,
            ask=self.ask,
            last=self.last,
            bid_size=self.bid_size,
            ask_size=self.ask_size,
            volume=self.volume,
            open_interest=self.open_interest,
            ibkr_iv=self.ibkr_iv,
            ibkr_delta=self.ibkr_delta,
            ibkr_gamma=self.ibkr_gamma,
            ibkr_vega=self.ibkr_vega,
            ibkr_theta=self.ibkr_theta,
        )


def _create_real_adapter(*, importer: Importer = __import__) -> IbkrDelayedSnapshotAdapter:
    try:
        client_module = importer("ibapi.client", fromlist=("EClient",))
        contract_module = importer("ibapi.contract", fromlist=("Contract",))
        wrapper_module = importer("ibapi.wrapper", fromlist=("EWrapper",))
        EClient = getattr(client_module, "EClient")
        Contract = getattr(contract_module, "Contract")
        EWrapper = getattr(wrapper_module, "EWrapper")
    except ImportError as exc:
        raise IbkrApiUnavailable("Install the official ibapi package to use IBKR delayed snapshots.") from exc

    ready_event = threading.Event()
    metadata: dict[str, object] = {}

    class DelayedSnapshotClient(EWrapper, EClient):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            EWrapper.__init__(self)
            EClient.__init__(self, wrapper=self)
            self._pending_market_data: dict[int, _PendingMarketData] = {}

        def nextValidId(self, orderId: int) -> None:
            metadata["next_order_id"] = orderId
            ready_event.set()

        def error(self, *args: object) -> None:
            error = _parse_ibkr_error_args(args)
            if error is None:
                return
            errors = metadata.setdefault("errors", [])
            if isinstance(errors, list):
                errors.append(error)
            code = int(error["code"])
            if code in _INFORMATIONAL_ERROR_CODES:
                return
            if code in _NO_DATA_QUOTE_ERROR_CODES:
                self._complete_matching_pending_without_quote(error)
                return
            if _RealIbkrDelayedSnapshotAdapter.is_connection_error_code(code):
                metadata["terminal_error"] = error
                self._fail_all_pending(error)
                ready_event.set()
                return
            self._fail_matching_pending(error)

        def connectionClosed(self) -> None:
            error = {
                "id": -1,
                "error_time": None,
                "code": 507,
                "message": "connection closed",
                "advanced": "",
            }
            metadata.setdefault("terminal_error", error)
            self._fail_all_pending(error)
            ready_event.set()

        def connectClosed(self) -> None:
            self.connectionClosed()

        def tickPrice(self, reqId: int, tickType: int, price: float, _attrib: object) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is None or price < 0:
                return
            if tickType in {1, 66}:
                pending.bid = float(price)
            elif tickType in {2, 67}:
                pending.ask = float(price)
            elif tickType in {4, 68}:
                pending.last = float(price)
            elif tickType in {9, 75}:
                pending.last = pending.last if pending.last is not None else float(price)

        def tickSize(self, reqId: int, tickType: int, size: float) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is None or size < 0:
                return
            if tickType in {0, 69}:
                pending.bid_size = float(size)
            elif tickType in {3, 70}:
                pending.ask_size = float(size)
            elif tickType in {8, 74}:
                pending.volume = float(size)

        def tickOptionComputation(
            self,
            reqId: int,
            tickType: int,
            _tickAttrib: int,
            impliedVol: float,
            delta: float,
            _optPrice: float,
            _pvDividend: float,
            gamma: float,
            vega: float,
            theta: float,
            _undPrice: float,
        ) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is None or tickType not in {10, 11, 12, 13, 80, 81, 82, 83}:
                return
            pending.ibkr_iv = _positive_or_none(impliedVol)
            pending.ibkr_delta = _finite_or_none(delta)
            pending.ibkr_gamma = _positive_or_none(gamma)
            pending.ibkr_vega = _positive_or_none(vega)
            pending.ibkr_theta = _finite_or_none(theta)

        def tickSnapshotEnd(self, reqId: int) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is not None:
                pending.snapshot_ended = True
                pending.event.set()

        def marketDataType(self, reqId: int, marketDataType: int) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is not None:
                pending.market_data_type = int(marketDataType)
            metadata["latest_market_data_type"] = int(marketDataType)

        def _fail_all_pending(self, error: dict[str, object]) -> None:
            for pending in self._pending_market_data.values():
                pending.error = error
                pending.event.set()

        def _fail_matching_pending(self, error: dict[str, object]) -> None:
            req_id = error.get("id")
            if not isinstance(req_id, int) or req_id < 0:
                return
            pending = self._pending_market_data.get(req_id)
            if pending is not None:
                pending.error = error
                pending.event.set()

        def _complete_matching_pending_without_quote(self, error: dict[str, object]) -> None:
            req_id = error.get("id")
            if not isinstance(req_id, int) or req_id < 0:
                return
            pending = self._pending_market_data.get(req_id)
            if pending is not None:
                pending.event.set()

    return _RealIbkrDelayedSnapshotAdapter(DelayedSnapshotClient(), Contract, ready_event, metadata)


def _snapshot_underlying(
    ibkr: IbkrHealthConfig,
    adapter_factory: AdapterFactory,
    market_data_type: int,
) -> DelayedMarketDataQuote:
    adapter = adapter_factory()
    try:
        adapter.connect(ibkr.host, ibkr.port, ibkr.client_id)
        adapter.wait_until_ready(ibkr.timeout_seconds)
        adapter.request_market_data_type(market_data_type)
        return adapter.snapshot_underlying(ibkr.timeout_seconds)
    except BaseException as exc:
        _disconnect_preserving_primary(adapter, exc)
        raise
    else:
        adapter.disconnect()
    finally:
        if sys.exc_info()[0] is None:
            adapter.disconnect()


def _snapshot_options(
    ibkr: IbkrHealthConfig,
    adapter_factory: AdapterFactory,
    contracts: Iterable[dict[str, object]],
    market_data_type: int,
) -> dict[str, DelayedMarketDataQuote]:
    adapter = adapter_factory()
    try:
        adapter.connect(ibkr.host, ibkr.port, ibkr.client_id)
        adapter.wait_until_ready(ibkr.timeout_seconds)
        adapter.request_market_data_type(market_data_type)
        return adapter.snapshot_options(contracts, ibkr.timeout_seconds)
    except BaseException as exc:
        _disconnect_preserving_primary(adapter, exc)
        raise
    finally:
        if sys.exc_info()[0] is None:
            adapter.disconnect()


def _option_event(
    *,
    session_id: str,
    contract: dict[str, object],
    quote: DelayedMarketDataQuote,
) -> dict[str, object]:
    return option_tick_event(
        session_id=session_id,
        contract_id=str(contract["contract_id"]),
        bid=quote.bid,
        ask=quote.ask,
        last=quote.last,
        bid_size=quote.bid_size,
        ask_size=quote.ask_size,
        volume=quote.volume,
        open_interest=quote.open_interest,
        ibkr_iv=quote.ibkr_iv,
        ibkr_delta=quote.ibkr_delta,
        ibkr_gamma=quote.ibkr_gamma,
        ibkr_vega=quote.ibkr_vega,
        ibkr_theta=quote.ibkr_theta,
    )


def _disconnect_preserving_primary(adapter: IbkrDelayedSnapshotAdapter, primary: BaseException) -> None:
    try:
        adapter.disconnect()
    except Exception as exc:
        primary.add_note(f"IBKR API disconnect also failed: {exc}")


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expiry must use YYYY-MM-DD") from exc


def _parse_ibkr_error_args(args: tuple[object, ...]) -> dict[str, object] | None:
    if len(args) == 3:
        req_id, error_code, error_string = args
        advanced_order_reject_json = ""
        error_time = None
    elif len(args) == 4:
        req_id, error_code, error_string, advanced_order_reject_json = args
        error_time = None
    elif len(args) == 5:
        req_id, error_time, error_code, error_string, advanced_order_reject_json = args
    else:
        return None

    try:
        code = int(error_code)
    except (TypeError, ValueError):
        return None

    return {
        "id": req_id,
        "error_time": error_time,
        "code": code,
        "message": str(error_string),
        "advanced": str(advanced_order_reject_json or ""),
    }


def _broker_error_message(error: object) -> str | None:
    if error is None:
        return None
    if not isinstance(error, dict):
        return str(error)
    parts = []
    if error.get("id") is not None:
        parts.append(f"id {error['id']}")
    if error.get("code") is not None:
        parts.append(f"code {error['code']}")
    if error.get("message"):
        parts.append(str(error["message"]))
    if error.get("advanced"):
        parts.append(str(error["advanced"]))
    return ": ".join(parts) if parts else str(error)


def _timeout_message(label: str, timeout_seconds: float, metadata: dict[str, object]) -> str:
    message = f"timed out waiting {timeout_seconds:g}s for {label}"
    errors = metadata.get("errors")
    if isinstance(errors, list) and errors:
        latest_error = _broker_error_message(errors[-1])
        if latest_error is not None:
            return f"{message}; latest IBKR API error {latest_error}"
    return message


def _validated_ibkr_config(config: IbkrHealthConfig, **overrides: object) -> IbkrHealthConfig:
    candidate = replace(config, **overrides)
    return ibkr_health_config_from_env(
        {
            "GAMMASCOPE_IBKR_HOST": candidate.host,
            "GAMMASCOPE_IBKR_PORT": str(candidate.port),
            "GAMMASCOPE_IBKR_CLIENT_ID": str(candidate.client_id),
            "GAMMASCOPE_COLLECTOR_ID": candidate.collector_id,
            "GAMMASCOPE_IBKR_ACCOUNT_MODE": candidate.account_mode,
            "GAMMASCOPE_API_BASE_URL": candidate.api_base,
            "GAMMASCOPE_IBKR_TIMEOUT_SECONDS": str(candidate.timeout_seconds),
        }
    )


def _summary_dict(summary: PublishSummary | dict[str, object]) -> dict[str, object]:
    if isinstance(summary, dict):
        return dict(summary)
    return summary.as_dict()


def _resolve_market_data_type(value: str | int, *, now: datetime | None = None) -> int:
    if isinstance(value, int):
        if value in _MARKET_DATA_TYPE_NAMES:
            return value
        raise ValueError("market_data_type must be 3, 4, delayed, delayed-frozen, or auto")

    normalized = value.strip().lower().replace("_", "-")
    if normalized in {"3", "delayed"}:
        return DELAYED_MARKET_DATA_TYPE
    if normalized in {"4", "delayed-frozen"}:
        return DELAYED_FROZEN_MARKET_DATA_TYPE
    if normalized == "auto":
        return DELAYED_MARKET_DATA_TYPE if _is_regular_market_hours(now or datetime.now(UTC)) else DELAYED_FROZEN_MARKET_DATA_TYPE
    raise ValueError("market_data_type must be 3, 4, delayed, delayed-frozen, or auto")


def _is_regular_market_hours(now: datetime) -> bool:
    local_now = now.astimezone(_EASTERN_TIME)
    return (
        local_now.weekday() < 5
        and _REGULAR_SESSION_START <= local_now.time().replace(tzinfo=None) < _REGULAR_SESSION_END
    )


def _market_data_type_name(market_data_type: int) -> str:
    try:
        return _MARKET_DATA_TYPE_NAMES[market_data_type]
    except KeyError as exc:
        raise ValueError("market_data_type must be 3 or 4") from exc


def _positive_or_none(value: object) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    return numeric if isfinite(numeric) and numeric > 0 else None


def _finite_or_none(value: object) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    return None if not isfinite(numeric) or numeric in {-1, -2} else numeric


def _print_json(value: dict[str, object]) -> None:
    print(json.dumps(value, separators=(",", ":"), sort_keys=True))


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
