from __future__ import annotations

import argparse
import json
import sys
import threading
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal, Protocol
from uuid import uuid4

from gammascope_collector.events import contract_discovered_event
from gammascope_collector.ibkr_config import IbkrHealthConfig, ibkr_health_config_from_env
from gammascope_collector.publisher import PublishSummary, publish_events

Right = Literal["call", "put"]


class IbkrApiUnavailable(RuntimeError):
    pass


class IbkrContractDiscoveryTimeout(TimeoutError):
    pass


class IbkrBrokerError(OSError):
    pass


@dataclass(frozen=True)
class OptionMetadata:
    trading_class: str
    exchange: str
    multiplier: str
    expirations: frozenset[str]
    strikes: frozenset[float]


@dataclass(frozen=True)
class OptionContractRequest:
    trading_class: str
    expiry: str
    right: Right
    strike: float


@dataclass(frozen=True)
class ResolvedIbkrContract:
    ibkr_con_id: int
    trading_class: str
    expiry: str
    right: Right
    strike: float
    exchange: str = "CBOE"
    currency: str = "USD"
    multiplier: float = 100.0


@dataclass(frozen=True)
class IbkrContractDiscoveryConfig:
    ibkr: IbkrHealthConfig
    expiry: date
    spot: float | None = None
    strike_window_points: float = 100.0
    max_strikes: int | None = None
    session_id: str = ""
    symbol: str = "SPX"

    def with_overrides(self, **overrides: object) -> IbkrContractDiscoveryConfig:
        return replace(self, **overrides)


@dataclass(frozen=True)
class ContractDiscoveryResult:
    session_id: str
    symbol: str
    target_expiry: str
    spot: float
    events: list[dict[str, object]]

    @property
    def contracts_count(self) -> int:
        return len(self.events)

    def as_dict(self) -> dict[str, object]:
        return {
            "session_id": self.session_id,
            "symbol": self.symbol,
            "target_expiry": self.target_expiry,
            "spot": self.spot,
            "contracts_count": self.contracts_count,
            "events": self.events,
        }


class IbkrContractDiscoveryAdapter(Protocol):
    def connect(self, host: str, port: int, client_id: int) -> None:
        ...

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        ...

    def resolve_underlying(self, timeout_seconds: float) -> int:
        ...

    def lookup_spot(self, timeout_seconds: float) -> float:
        ...

    def option_metadata(self, underlying_con_id: int, timeout_seconds: float) -> list[OptionMetadata]:
        ...

    def resolve_option_contracts(
        self,
        requests: Iterable[OptionContractRequest],
        timeout_seconds: float,
    ) -> list[ResolvedIbkrContract]:
        ...

    def disconnect(self) -> None:
        ...


AdapterFactory = Callable[[], IbkrContractDiscoveryAdapter]
Importer = Callable[..., object]
Publish = Callable[..., PublishSummary | dict[str, object]]


def select_strikes(
    strikes: Iterable[float],
    *,
    spot: float,
    strike_window_points: float,
    max_strikes: int | None = None,
) -> list[float]:
    lower = spot - strike_window_points
    upper = spot + strike_window_points
    candidates = sorted({float(strike) for strike in strikes if lower <= float(strike) <= upper})
    if max_strikes is not None:
        candidates = sorted(sorted(candidates, key=lambda strike: (abs(strike - spot), strike))[:max_strikes])
    return candidates


def select_candidate_metadata(metadata: Iterable[OptionMetadata], expiry: str) -> OptionMetadata | None:
    same_expiry = [
        item
        for item in metadata
        if expiry in item.expirations and item.trading_class.upper() in {"SPXW", "SPX"}
    ]
    if not same_expiry:
        return None
    preferred_class = "SPXW" if any(item.trading_class.upper() == "SPXW" for item in same_expiry) else "SPX"
    preferred = [item for item in same_expiry if item.trading_class.upper() == preferred_class]
    return OptionMetadata(
        trading_class=preferred_class,
        exchange=_stable_metadata_value(item.exchange for item in preferred),
        multiplier=_stable_metadata_value(item.multiplier for item in preferred),
        expirations=frozenset().union(*(item.expirations for item in preferred)),
        strikes=frozenset().union(*(item.strikes for item in preferred)),
    )


def _stable_metadata_value(values: Iterable[str]) -> str:
    normalized = sorted({value for value in values if value})
    return normalized[0] if normalized else ""


def discover_spx_0dte_contracts(
    config: IbkrContractDiscoveryConfig,
    *,
    adapter_factory: AdapterFactory | None = None,
) -> ContractDiscoveryResult:
    adapter = adapter_factory() if adapter_factory is not None else _create_real_adapter()
    session_id = config.session_id or f"ibkr-spx-0dte-{uuid4()}"
    target_expiry = config.expiry.isoformat()
    ibkr_expiry = _ibkr_expiry(config.expiry)
    try:
        adapter.connect(config.ibkr.host, config.ibkr.port, config.ibkr.client_id)
        adapter.wait_until_ready(config.ibkr.timeout_seconds)
        underlying_con_id = adapter.resolve_underlying(config.ibkr.timeout_seconds)
        spot = float(config.spot) if config.spot is not None else adapter.lookup_spot(config.ibkr.timeout_seconds)
        metadata = adapter.option_metadata(underlying_con_id, config.ibkr.timeout_seconds)
        selected_metadata = select_candidate_metadata(metadata, ibkr_expiry)
        if selected_metadata is None:
            return ContractDiscoveryResult(
                session_id=session_id,
                symbol=config.symbol,
                target_expiry=target_expiry,
                spot=spot,
                events=[],
            )

        strikes = select_strikes(
            selected_metadata.strikes,
            spot=spot,
            strike_window_points=config.strike_window_points,
            max_strikes=config.max_strikes,
        )
        requests = [
            OptionContractRequest(
                trading_class=selected_metadata.trading_class,
                expiry=ibkr_expiry,
                right=right,
                strike=strike,
            )
            for strike in strikes
            for right in ("call", "put")
        ]
        contracts = adapter.resolve_option_contracts(requests, config.ibkr.timeout_seconds)
        return ContractDiscoveryResult(
            session_id=session_id,
            symbol=config.symbol,
            target_expiry=target_expiry,
            spot=spot,
            events=_contract_events(session_id, target_expiry, contracts),
        )
    except BaseException as exc:
        _disconnect_preserving_primary(adapter, exc)
        raise
    finally:
        if sys.exc_info()[0] is None:
            adapter.disconnect()


def main(
    argv: Sequence[str] | None = None,
    *,
    adapter_factory: AdapterFactory | None = None,
    publish: Publish | None = None,
) -> None:
    defaults = ibkr_health_config_from_env()
    parser = argparse.ArgumentParser(description="Discover SPX 0DTE option contracts through the IBKR API.")
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
    config = IbkrContractDiscoveryConfig(
        ibkr=ibkr_config,
        expiry=args.expiry,
        spot=args.spot,
        strike_window_points=args.strike_window_points,
        max_strikes=args.max_strikes,
        session_id=args.session_id or "",
    )

    try:
        result = discover_spx_0dte_contracts(config, adapter_factory=adapter_factory)
    except IbkrApiUnavailable as exc:
        _print_json(
            {
                "status": "error",
                "message": f"IBKR contract discovery unavailable: missing ibapi package ({exc})",
            }
        )
        raise SystemExit(1) from exc
    except (IbkrContractDiscoveryTimeout, OSError) as exc:
        _print_json(
            {
                "status": "error",
                "message": f"IBKR contract discovery failed: {exc}",
            }
        )
        raise SystemExit(1) from exc

    if args.publish:
        publisher = publish or publish_events
        summary = _summary_dict(publisher(result.events, api_base=ibkr_config.api_base))
        summary.update(
            {
                "contracts_count": result.contracts_count,
                "session_id": result.session_id,
                "target_expiry": result.target_expiry,
            }
        )
        _print_json(summary)
        return

    _print_json(result.as_dict())


class _RealIbkrContractDiscoveryAdapter:
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
        self._thread = threading.Thread(target=self._client.run, name="ibkr-contract-api-loop", daemon=True)
        self._thread.start()

    def wait_until_ready(self, timeout_seconds: float) -> dict[str, object]:
        if not self._ready_event.wait(timeout_seconds):
            raise IbkrContractDiscoveryTimeout(_timeout_message("nextValidId", timeout_seconds, self._metadata))
        terminal_error = _broker_error_message(self._metadata.get("terminal_error"))
        if terminal_error is not None:
            raise IbkrBrokerError(f"IBKR API broker error {terminal_error}")
        return dict(self._metadata)

    def resolve_underlying(self, timeout_seconds: float) -> int:
        req_id = self._request_id()
        pending = _PendingContractDetails()
        self._client._pending_contract_details[req_id] = pending
        contract = self._contract()
        contract.symbol = "SPX"
        contract.secType = "IND"
        contract.exchange = "CBOE"
        contract.currency = "USD"
        self._client.reqContractDetails(req_id, contract)
        self._wait_pending(req_id, pending, "SPX underlying contract details", timeout_seconds)
        if not pending.contracts:
            raise IbkrContractDiscoveryTimeout("IBKR returned no SPX underlying contract details")
        con_id = getattr(pending.contracts[0], "conId", 0)
        if not con_id:
            raise IbkrContractDiscoveryTimeout("IBKR SPX underlying contract details did not include conId")
        return int(con_id)

    def lookup_spot(self, timeout_seconds: float) -> float:
        req_id = self._request_id()
        pending = _PendingMarketData()
        self._client._pending_market_data[req_id] = pending
        contract = self._contract()
        contract.symbol = "SPX"
        contract.secType = "IND"
        contract.exchange = "CBOE"
        contract.currency = "USD"
        self._client.reqMktData(req_id, contract, "", True, False, [])
        try:
            if not pending.event.wait(timeout_seconds):
                raise IbkrContractDiscoveryTimeout(f"timed out waiting {timeout_seconds:g}s for SPX spot")
            if pending.error is not None:
                raise IbkrBrokerError(f"IBKR API broker error {_broker_error_message(pending.error)}")
            spot = pending.spot()
            if spot is None:
                if pending.snapshot_ended:
                    raise IbkrContractDiscoveryTimeout("IBKR SPX spot snapshot ended without usable SPX spot")
                raise IbkrContractDiscoveryTimeout(f"timed out waiting {timeout_seconds:g}s for SPX spot")
            return spot
        finally:
            cancel = getattr(self._client, "cancelMktData", None)
            if cancel is not None:
                try:
                    cancel(req_id)
                except Exception:
                    pass
            self._client._pending_market_data.pop(req_id, None)

    def option_metadata(self, underlying_con_id: int, timeout_seconds: float) -> list[OptionMetadata]:
        req_id = self._request_id()
        pending = _PendingOptionMetadata()
        self._client._pending_option_metadata[req_id] = pending
        self._client.reqSecDefOptParams(req_id, "SPX", "", "IND", underlying_con_id)
        self._wait_pending(req_id, pending, "SPX option metadata", timeout_seconds)
        return list(pending.metadata)

    def resolve_option_contracts(
        self,
        requests: Iterable[OptionContractRequest],
        timeout_seconds: float,
    ) -> list[ResolvedIbkrContract]:
        resolved: list[ResolvedIbkrContract] = []
        for request in requests:
            req_id = self._request_id()
            pending = _PendingContractDetails()
            self._client._pending_contract_details[req_id] = pending
            self._client.reqContractDetails(req_id, self._option_contract(request))
            self._wait_pending(req_id, pending, f"{request.trading_class} option contract details", timeout_seconds)
            resolved.extend(_deduplicated_resolved_contracts(pending.contracts, request))
        return resolved

    def disconnect(self) -> None:
        try:
            self._client.disconnect()
        finally:
            self._join_thread()

    def _join_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(self._THREAD_JOIN_TIMEOUT_SECONDS)

    def _request_id(self) -> int:
        req_id = self._next_req_id
        self._next_req_id += 1
        return req_id

    def _contract(self) -> object:
        return self._contract_type()

    def _option_contract(self, request: OptionContractRequest) -> object:
        contract = self._contract()
        contract.symbol = "SPX"
        contract.secType = "OPT"
        contract.exchange = "SMART"
        contract.currency = "USD"
        contract.lastTradeDateOrContractMonth = request.expiry
        contract.strike = request.strike
        contract.right = "C" if request.right == "call" else "P"
        contract.multiplier = "100"
        contract.tradingClass = request.trading_class
        return contract

    def _wait_pending(self, req_id: int, pending: _PendingBase, label: str, timeout_seconds: float) -> None:
        try:
            if not pending.event.wait(timeout_seconds):
                raise IbkrContractDiscoveryTimeout(_timeout_message(label, timeout_seconds, self._metadata))
            if pending.error is not None:
                raise IbkrBrokerError(f"IBKR API broker error {_broker_error_message(pending.error)}")
        finally:
            self._client._pending_contract_details.pop(req_id, None)
            self._client._pending_option_metadata.pop(req_id, None)

    @classmethod
    def is_connection_error_code(cls, code: int) -> bool:
        return code in cls._CONNECTION_ERROR_CODES


@dataclass
class _PendingBase:
    event: threading.Event
    error: dict[str, object] | None = None

    def __init__(self) -> None:
        self.event = threading.Event()
        self.error = None


class _PendingContractDetails(_PendingBase):
    def __init__(self) -> None:
        super().__init__()
        self.contracts: list[object] = []


class _PendingOptionMetadata(_PendingBase):
    def __init__(self) -> None:
        super().__init__()
        self.metadata: list[OptionMetadata] = []


class _PendingMarketData:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.bid: float | None = None
        self.ask: float | None = None
        self.last: float | None = None
        self.mark: float | None = None
        self.close: float | None = None
        self.error: dict[str, object] | None = None
        self.snapshot_ended = False

    def spot(self) -> float | None:
        if self.last is not None:
            return self.last
        if self.bid is not None and self.ask is not None:
            return (self.bid + self.ask) / 2
        if self.mark is not None:
            return self.mark
        return self.close


def _create_real_adapter(*, importer: Importer = __import__) -> IbkrContractDiscoveryAdapter:
    try:
        client_module = importer("ibapi.client", fromlist=("EClient",))
        contract_module = importer("ibapi.contract", fromlist=("Contract",))
        wrapper_module = importer("ibapi.wrapper", fromlist=("EWrapper",))
        EClient = getattr(client_module, "EClient")
        Contract = getattr(contract_module, "Contract")
        EWrapper = getattr(wrapper_module, "EWrapper")
    except ImportError as exc:
        raise IbkrApiUnavailable("Install the official ibapi package to use IBKR contract discovery.") from exc

    ready_event = threading.Event()
    metadata: dict[str, object] = {}

    class ContractDiscoveryClient(EWrapper, EClient):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            EWrapper.__init__(self)
            EClient.__init__(self, wrapper=self)
            self._pending_contract_details: dict[int, _PendingContractDetails] = {}
            self._pending_option_metadata: dict[int, _PendingOptionMetadata] = {}
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
            if _RealIbkrContractDiscoveryAdapter.is_connection_error_code(int(error["code"])):
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

        def contractDetails(self, reqId: int, contractDetails: object) -> None:
            pending = self._pending_contract_details.get(reqId)
            if pending is None:
                return
            pending.contracts.append(getattr(contractDetails, "contract", contractDetails))

        def contractDetailsEnd(self, reqId: int) -> None:
            pending = self._pending_contract_details.get(reqId)
            if pending is not None:
                pending.event.set()

        def securityDefinitionOptionParameter(
            self,
            reqId: int,
            exchange: str,
            _underlyingConId: int,
            tradingClass: str,
            multiplier: str,
            expirations: set[str],
            strikes: set[float],
        ) -> None:
            pending = self._pending_option_metadata.get(reqId)
            if pending is None:
                return
            pending.metadata.append(
                OptionMetadata(
                    trading_class=str(tradingClass),
                    exchange=str(exchange),
                    multiplier=str(multiplier),
                    expirations=frozenset(str(expiration) for expiration in expirations),
                    strikes=frozenset(float(strike) for strike in strikes),
                )
            )

        def securityDefinitionOptionParameterEnd(self, reqId: int) -> None:
            pending = self._pending_option_metadata.get(reqId)
            if pending is not None:
                pending.event.set()

        def tickPrice(self, reqId: int, tickType: int, price: float, _attrib: object) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is None or price <= 0:
                return
            if tickType in {1, 66}:
                pending.bid = float(price)
                if pending.ask is not None:
                    pending.event.set()
            elif tickType in {2, 67}:
                pending.ask = float(price)
                if pending.bid is not None:
                    pending.event.set()
            elif tickType in {4, 68}:
                pending.last = float(price)
                pending.event.set()
            elif tickType == 37:
                pending.mark = float(price)
                pending.event.set()
            elif tickType in {9, 75}:
                pending.close = float(price)
                pending.event.set()

        def tickSnapshotEnd(self, reqId: int) -> None:
            pending = self._pending_market_data.get(reqId)
            if pending is not None:
                pending.snapshot_ended = True
                pending.event.set()

        def _fail_all_pending(self, error: dict[str, object]) -> None:
            for pending in [
                *self._pending_contract_details.values(),
                *self._pending_option_metadata.values(),
                *self._pending_market_data.values(),
            ]:
                pending.error = error
                pending.event.set()

        def _fail_matching_pending(self, error: dict[str, object]) -> None:
            req_id = error.get("id")
            if not isinstance(req_id, int) or req_id < 0:
                return
            pending = (
                self._pending_contract_details.get(req_id)
                or self._pending_option_metadata.get(req_id)
                or self._pending_market_data.get(req_id)
            )
            if pending is not None:
                pending.error = error
                pending.event.set()

    return _RealIbkrContractDiscoveryAdapter(ContractDiscoveryClient(), Contract, ready_event, metadata)


def _contract_events(
    session_id: str,
    target_expiry: str,
    contracts: Iterable[ResolvedIbkrContract],
) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    seen_contract_ids: set[str] = set()
    for contract in contracts:
        event = contract_discovered_event(
            session_id=session_id,
            ibkr_con_id=contract.ibkr_con_id,
            symbol="SPX",
            expiry=target_expiry,
            right=contract.right,
            strike=contract.strike,
            multiplier=contract.multiplier,
            exchange=contract.exchange,
            currency=contract.currency,
        )
        contract_id = str(event["contract_id"])
        if contract_id in seen_contract_ids:
            continue
        seen_contract_ids.add(contract_id)
        events.append(event)
    return events


def _resolved_contract(contract: object, fallback: OptionContractRequest) -> ResolvedIbkrContract:
    right = getattr(contract, "right", "C")
    return ResolvedIbkrContract(
        ibkr_con_id=int(getattr(contract, "conId")),
        trading_class=str(getattr(contract, "tradingClass", fallback.trading_class) or fallback.trading_class),
        expiry=str(getattr(contract, "lastTradeDateOrContractMonth", fallback.expiry) or fallback.expiry),
        right="call" if str(right).upper().startswith("C") else "put",
        strike=float(getattr(contract, "strike", fallback.strike) or fallback.strike),
        exchange=str(getattr(contract, "exchange", "CBOE") or "CBOE"),
        currency=str(getattr(contract, "currency", "USD") or "USD"),
        multiplier=float(getattr(contract, "multiplier", 100) or 100),
    )


def _deduplicated_resolved_contracts(
    contracts: Iterable[object],
    fallback: OptionContractRequest,
) -> list[ResolvedIbkrContract]:
    by_con_id: dict[int, ResolvedIbkrContract] = {}
    for contract in contracts:
        resolved = _resolved_contract(contract, fallback)
        by_con_id.setdefault(resolved.ibkr_con_id, resolved)
    if len(by_con_id) > 1:
        con_ids = ", ".join(str(con_id) for con_id in sorted(by_con_id))
        raise IbkrBrokerError(
            f"IBKR returned ambiguous option contract details for "
            f"{fallback.trading_class} {fallback.expiry} {fallback.right} {fallback.strike:g}: conIds {con_ids}"
        )
    return list(by_con_id.values())


def _disconnect_preserving_primary(adapter: IbkrContractDiscoveryAdapter, primary: BaseException) -> None:
    try:
        adapter.disconnect()
    except Exception as exc:
        primary.add_note(f"IBKR API disconnect also failed: {exc}")


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expiry must use YYYY-MM-DD") from exc


def _ibkr_expiry(value: date) -> str:
    return value.strftime("%Y%m%d")


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


def _print_json(value: dict[str, object]) -> None:
    print(json.dumps(value, separators=(",", ":"), sort_keys=True))


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


if __name__ == "__main__":
    main()
