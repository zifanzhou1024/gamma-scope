from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any, Protocol

from gammascope_collector.moomoo_config import (
    SNAPSHOT_CODE_LIMIT,
    MoomooCollectorConfig,
    MoomooSymbolConfig,
    SnapshotRateEstimate,
    chunked,
    estimate_snapshot_request_rate,
    parse_manual_spots,
    selected_symbols,
)

RET_OK = 0


class MoomooQuoteClient(Protocol):
    def query_subscription(self, is_all_conn: bool = True) -> tuple[int, Any]:
        ...

    def get_option_chain(self, code: str, start: str, end: str) -> tuple[int, Any]:
        ...

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, Any]:
        ...

    def close(self) -> None:
        ...


ClientFactory = Callable[[str, int], MoomooQuoteClient]


@dataclass(frozen=True)
class MoomooContract:
    symbol: str
    owner_code: str
    option_code: str
    option_type: str
    strike: float
    expiry: date
    name: str = ""


@dataclass(frozen=True)
class MoomooOptionRow:
    symbol: str
    owner_code: str
    option_code: str
    option_type: str
    strike: float
    expiry: date
    name: str
    last_price: float | None = None
    bid_price: float | None = None
    ask_price: float | None = None
    bid_size: float | None = None
    ask_size: float | None = None
    volume: float | None = None
    open_interest: float | None = None
    implied_volatility: float | None = None
    delta: float | None = None
    gamma: float | None = None
    vega: float | None = None
    theta: float | None = None

    @property
    def mid_price(self) -> float | None:
        if self.bid_price is None or self.ask_price is None:
            return None
        return (self.bid_price + self.ask_price) / 2

    def as_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["expiry"] = self.expiry.isoformat()
        data["mid_price"] = self.mid_price
        return data


@dataclass(frozen=True)
class MoomooSymbolDiscoveryResult:
    symbol: str
    owner_code: str
    spot: float | None
    contracts: list[MoomooContract]
    warnings: list[str]

    def as_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "owner_code": self.owner_code,
            "spot": self.spot,
            "selected_contracts": len(self.contracts),
            "warnings": self.warnings,
        }


@dataclass(frozen=True)
class MoomooSnapshotResult:
    status: str
    subscription: object
    discoveries: list[MoomooSymbolDiscoveryResult]
    rows: list[MoomooOptionRow]
    total_selected_codes: int
    rate_estimate: SnapshotRateEstimate
    warnings: list[str]

    @property
    def snapshot_rows_count(self) -> int:
        return len(self.rows)

    def as_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "subscription": self.subscription,
            "total_selected_codes": self.total_selected_codes,
            "snapshot_rows_count": self.snapshot_rows_count,
            "warnings": self.warnings,
            "rate_estimate": asdict(self.rate_estimate),
            "per_symbol": [discovery.as_dict() for discovery in self.discoveries],
        }


def select_atm_strikes(strikes: Sequence[float], *, spot: float, down: int, up: int) -> list[float]:
    ordered = sorted({float(strike) for strike in strikes})
    if not ordered:
        return []
    nearest_index = min(range(len(ordered)), key=lambda index: (abs(ordered[index] - spot), ordered[index]))
    start = max(0, nearest_index - down)
    end = min(len(ordered), nearest_index + up + 1)
    return ordered[start:end]


def discover_symbol_contracts(
    client: MoomooQuoteClient,
    symbol_config: MoomooSymbolConfig,
    *,
    expiry: date,
) -> MoomooSymbolDiscoveryResult:
    warnings: list[str] = []
    spot = symbol_config.manual_spot
    if symbol_config.requires_manual_spot and spot is None:
        return MoomooSymbolDiscoveryResult(
            symbol=symbol_config.symbol,
            owner_code=symbol_config.owner_code,
            spot=None,
            contracts=[],
            warnings=[f"{symbol_config.symbol} requires manual spot and none was supplied"],
        )

    if spot is None:
        spot = _snapshot_underlying_spot(client, symbol_config.owner_code)
        if spot is None:
            warnings.append(f"{symbol_config.symbol} spot unavailable; skipping")
            return MoomooSymbolDiscoveryResult(
                symbol=symbol_config.symbol,
                owner_code=symbol_config.owner_code,
                spot=None,
                contracts=[],
                warnings=warnings,
            )

    expiry_text = expiry.isoformat()
    return_code, chain_data = client.get_option_chain(symbol_config.owner_code, expiry_text, expiry_text)
    if return_code != RET_OK:
        warnings.append(f"{symbol_config.symbol} option chain request failed with code {return_code}")
        return MoomooSymbolDiscoveryResult(symbol_config.symbol, symbol_config.owner_code, float(spot), [], warnings)

    target_rows = [_normalize_record(row) for row in _records(chain_data)]
    target_rows = [row for row in target_rows if _record_expiry(row) == expiry]
    filtered_rows = target_rows
    family_filter = symbol_config.family_filter
    if family_filter:
        family = family_filter.upper()
        matched = [
            row
            for row in target_rows
            if family in str(row.get("name", "")).upper() or family in str(row.get("code", "")).upper()
        ]
        if matched:
            filtered_rows = matched
        elif target_rows:
            warnings.append(
                f"{symbol_config.symbol} family filter {family_filter} matched zero rows; using unfiltered chain"
            )

    strikes = [_record_strike(row) for row in filtered_rows]
    selected_strikes = set(
        select_atm_strikes(
            [strike for strike in strikes if strike is not None],
            spot=float(spot),
            down=symbol_config.strike_window_down,
            up=symbol_config.strike_window_up,
        )
    )
    contracts = [
        contract
        for row in filtered_rows
        if (contract := _contract_from_record(symbol_config, row, expiry)) is not None
        and contract.strike in selected_strikes
    ]
    contracts.sort(key=lambda contract: (contract.strike, contract.option_type, contract.option_code))
    return MoomooSymbolDiscoveryResult(
        symbol=symbol_config.symbol,
        owner_code=symbol_config.owner_code,
        spot=float(spot),
        contracts=contracts,
        warnings=warnings,
    )


def collect_moomoo_snapshot_once(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    expiry: date,
) -> MoomooSnapshotResult:
    subscription_code, subscription = client.query_subscription(is_all_conn=True)
    if subscription_code != RET_OK:
        subscription = {"return_code": subscription_code, "data": subscription}

    discoveries = [discover_symbol_contracts(client, symbol, expiry=expiry) for symbol in selected_symbols(config)]
    contract_by_code: dict[str, MoomooContract] = {}
    for discovery in discoveries:
        for contract in discovery.contracts:
            contract_by_code[contract.option_code] = contract

    codes = sorted(contract_by_code)
    rate_estimate = estimate_snapshot_request_rate(len(codes), config.refresh_interval_seconds)
    warnings = [warning for discovery in discoveries for warning in discovery.warnings]
    if not rate_estimate.within_limit:
        warnings.append(
            f"Snapshot preflight exceeds limit: {rate_estimate.requests_per_30_seconds} requests per 30 seconds"
        )

    rows: list[MoomooOptionRow] = []
    for code_chunk in chunked(codes, SNAPSHOT_CODE_LIMIT):
        return_code, snapshot_data = client.get_market_snapshot(code_chunk)
        if return_code != RET_OK:
            warnings.append(f"Snapshot request failed with code {return_code}")
            continue
        for record in _records(snapshot_data):
            normalized = _normalize_record(record)
            code = str(normalized.get("code", ""))
            contract = contract_by_code.get(code)
            if contract is not None:
                rows.append(normalize_snapshot_record(contract, normalized))

    return MoomooSnapshotResult(
        status="connected" if rows else "degraded",
        subscription=subscription,
        discoveries=discoveries,
        rows=rows,
        total_selected_codes=len(codes),
        rate_estimate=rate_estimate,
        warnings=warnings,
    )


def run_moomoo_snapshot_loop(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    expiry: date,
    max_loops: int | None = None,
) -> MoomooSnapshotResult:
    result: MoomooSnapshotResult | None = None
    loops = 0
    while max_loops is None or loops < max_loops:
        result = collect_moomoo_snapshot_once(client, config, expiry=expiry)
        loops += 1
        if max_loops is None or loops < max_loops:
            time.sleep(config.refresh_interval_seconds)
    if result is None:
        result = collect_moomoo_snapshot_once(client, config, expiry=expiry)
    return result


def normalize_snapshot_record(contract: MoomooContract, record: dict[str, object]) -> MoomooOptionRow:
    return MoomooOptionRow(
        symbol=contract.symbol,
        owner_code=contract.owner_code,
        option_code=contract.option_code,
        option_type=contract.option_type,
        strike=contract.strike,
        expiry=contract.expiry,
        name=str(record.get("name") or contract.name),
        last_price=_float_or_none(_first_present(record, "last_price", "last")),
        bid_price=_float_or_none(_first_present(record, "bid_price", "bid")),
        ask_price=_float_or_none(_first_present(record, "ask_price", "ask")),
        bid_size=_float_or_none(_first_present(record, "bid_volume", "bid_size")),
        ask_size=_float_or_none(_first_present(record, "ask_volume", "ask_size")),
        volume=_float_or_none(record.get("volume")),
        open_interest=_float_or_none(record.get("open_interest")),
        implied_volatility=_float_or_none(_first_present(record, "implied_volatility", "iv")),
        delta=_float_or_none(record.get("delta")),
        gamma=_float_or_none(record.get("gamma")),
        vega=_float_or_none(record.get("vega")),
        theta=_float_or_none(record.get("theta")),
    )


def main(argv: Sequence[str] | None = None, *, client_factory: ClientFactory | None = None) -> None:
    parser = argparse.ArgumentParser(description="Poll Moomoo option snapshots and print collector JSON.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11111)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--collector-id", default="local-moomoo")
    parser.add_argument("--expiry", type=_parse_date, required=True)
    parser.add_argument("--spot", action="append", default=[])
    parser.add_argument("--interval-seconds", type=float, default=2.0)
    parser.add_argument("--max-loops", type=int, default=1)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    client: MoomooQuoteClient | None = None
    try:
        config = MoomooCollectorConfig(
            host=args.host,
            port=args.port,
            refresh_interval_seconds=args.interval_seconds,
            collector_id=args.collector_id,
            api_base=args.api,
            manual_spots=parse_manual_spots(args.spot),
        )
        make_client = client_factory or _create_real_client
        client = make_client(args.host, args.port)
        result = run_moomoo_snapshot_loop(client, config, expiry=args.expiry, max_loops=args.max_loops)
        print(json.dumps(result.as_dict(), sort_keys=True, separators=(",", ":")))
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1) from exc
    finally:
        if client is not None:
            client.close()


def _create_real_client(host: str, port: int) -> MoomooQuoteClient:
    try:
        from moomoo import OpenQuoteContext
    except ImportError as exc:
        raise RuntimeError("moomoo-api package is not installed") from exc
    return OpenQuoteContext(host=host, port=port)


def _records(data: object) -> list[dict[str, object]]:
    if hasattr(data, "to_dict"):
        records = data.to_dict("records")
    elif isinstance(data, dict):
        records = [data]
    else:
        records = data
    return [_normalize_record(row) for row in records or []]  # type: ignore[union-attr]


def _normalize_record(row: object) -> dict[str, object]:
    if isinstance(row, dict):
        return row
    if hasattr(row, "_asdict"):
        return row._asdict()
    return dict(row)  # type: ignore[arg-type]


def _snapshot_underlying_spot(client: MoomooQuoteClient, owner_code: str) -> float | None:
    return_code, data = client.get_market_snapshot([owner_code])
    if return_code != RET_OK:
        return None
    for record in _records(data):
        for key in ("last_price", "close_price", "prev_close_price"):
            spot = _float_or_none(record.get(key))
            if spot is not None:
                return spot
    return None


def _contract_from_record(
    symbol_config: MoomooSymbolConfig,
    record: dict[str, object],
    expiry: date,
) -> MoomooContract | None:
    code = str(record.get("code") or "")
    strike = _record_strike(record)
    option_type = _option_type(record)
    if not code or strike is None or option_type is None:
        return None
    return MoomooContract(
        symbol=symbol_config.symbol,
        owner_code=symbol_config.owner_code,
        option_code=code,
        option_type=option_type,
        strike=strike,
        expiry=expiry,
        name=str(record.get("name") or code),
    )


def _record_expiry(record: dict[str, object]) -> date | None:
    value = record.get("strike_time") or record.get("expiry")
    if isinstance(value, date):
        return value
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _record_strike(record: dict[str, object]) -> float | None:
    return _float_or_none(_first_present(record, "strike_price", "strike"))


def _option_type(record: dict[str, object]) -> str | None:
    raw_value = str(record.get("option_type") or record.get("type") or "").upper()
    if raw_value in {"CALL", "C"}:
        return "CALL"
    if raw_value in {"PUT", "P"}:
        return "PUT"
    return None


def _float_or_none(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_present(record: dict[str, object], *keys: str) -> object:
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def _parse_date(raw_value: str) -> date:
    return date.fromisoformat(raw_value)


__all__ = [
    "MoomooQuoteClient",
    "MoomooContract",
    "MoomooOptionRow",
    "MoomooSymbolDiscoveryResult",
    "MoomooSnapshotResult",
    "select_atm_strikes",
    "discover_symbol_contracts",
    "collect_moomoo_snapshot_once",
    "run_moomoo_snapshot_loop",
    "normalize_snapshot_record",
    "main",
]
