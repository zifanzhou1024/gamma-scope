from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time as wall_time, timedelta
from pathlib import Path
from typing import Any

from gammascope_collector.moomoo_config import (
    DEFAULT_MOOMOO_HOST,
    DEFAULT_MOOMOO_PORT,
    MoomooCollectorConfig,
    MoomooSymbolConfig,
    chunked,
    parse_manual_spots,
    selected_symbols,
)
from gammascope_collector.moomoo_snapshot import (
    MARKET_TIMEZONE,
    RET_OK,
    MoomooContract,
    MoomooQuoteClient,
    MoomooSymbolDiscoveryResult,
    _normalize_record,
    _records,
    _target_expiry,
    discover_symbol_contracts,
    normalize_snapshot_record,
    resolve_moomoo_target_expiry,
)

DEFAULT_RESEARCH_OUTPUT_DIR = Path.home() / "local-ml-data" / "gamma-ml-research"
DEFAULT_RESEARCH_INTERVAL_SECONDS = 10.0
DEFAULT_TIMELINE_SECONDS = 10
DEFAULT_MARKET_OPEN = wall_time(9, 30)
DEFAULT_MARKET_CLOSE = wall_time(16, 0)
SCHEMA_VERSION = "1.0.0"

ClientFactory = Callable[[str, int], MoomooQuoteClient]
ExpiryProvider = Callable[[], date]
IntervalSecondsProvider = Callable[[], float]


@dataclass(frozen=True)
class ResearchCaptureSummary:
    capture_id: str
    time_utc: str
    captured_at_utc: str
    time_bucket_utc: str
    market_date: str
    expiry: str
    output_dir: str
    option_rows_written: int
    batch_rows_written: int
    underlying_rows_written: int
    selected_contracts: dict[str, int]
    option_files: list[str]
    batch_files: list[str]
    underlying_files: list[str]
    warnings: list[str]

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class MarketSessionWindow:
    market_date: str
    opens_at_utc: str
    closes_at_utc: str


def capture_research_snapshot_once(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    output_dir: Path,
    expiry: date,
    timeline_seconds: int = DEFAULT_TIMELINE_SECONDS,
) -> ResearchCaptureSummary:
    if timeline_seconds <= 0:
        raise ValueError("timeline_seconds must be greater than zero")

    output_dir = output_dir.expanduser()
    captured_at = datetime.now(UTC)
    capture_id = _capture_id(captured_at)
    timeline_bucket = _floor_datetime(captured_at, timeline_seconds)
    time_utc = _format_datetime(captured_at)
    time_bucket_utc = _format_datetime(timeline_bucket)
    market_date = captured_at.astimezone(MARKET_TIMEZONE).date().isoformat()

    symbols = selected_symbols(config)
    subscription_code, subscription = client.query_subscription(is_all_conn=True)
    warnings: list[str] = []
    if subscription_code != RET_OK:
        warnings.append(f"subscription query failed with code {subscription_code}")

    discoveries = [discover_symbol_contracts(client, symbol, expiry=expiry) for symbol in symbols]
    warnings.extend(warning for discovery in discoveries for warning in discovery.warnings)
    discovery_by_symbol = {discovery.symbol: discovery for discovery in discoveries}

    underlying_summary = _record_underlying_snapshots(
        client=client,
        symbols=symbols,
        discoveries=discovery_by_symbol,
        output_dir=output_dir,
        capture_id=capture_id,
        captured_at=captured_at,
        timeline_bucket=timeline_bucket,
        timeline_seconds=timeline_seconds,
        market_date=market_date,
        expiry=expiry,
    )
    warnings.extend(underlying_summary.warnings)

    contract_by_code: dict[str, MoomooContract] = {}
    for discovery in discoveries:
        for contract in discovery.contracts:
            contract_by_code[contract.option_code] = contract

    option_rows_written = 0
    option_files: set[Path] = set()
    batch_contracts_by_ticker: dict[str, list[dict[str, object]]] = {}
    batch_spot_by_ticker: dict[str, float | None] = {}
    returned_codes: set[str] = set()
    for code_chunk in chunked(sorted(contract_by_code), 400):
        return_code, snapshot_data = client.get_market_snapshot(code_chunk)
        if return_code != RET_OK:
            warnings.append(f"option snapshot request failed with code {return_code}")
            continue
        for raw_record in _records(snapshot_data):
            normalized_record = _normalize_record(raw_record)
            option_code = str(normalized_record.get("code") or "")
            contract = contract_by_code.get(option_code)
            if contract is None:
                continue
            returned_codes.add(option_code)
            discovery = discovery_by_symbol.get(contract.symbol)
            record = _option_output_record(
                raw_record=normalized_record,
                contract=contract,
                discovery=discovery,
                capture_id=capture_id,
                captured_at=captured_at,
                timeline_bucket=timeline_bucket,
                timeline_seconds=timeline_seconds,
                market_date=market_date,
                expiry=expiry,
            )
            path = _records_path(output_dir, "moomoo", "options", market_date, contract.symbol)
            _append_jsonl(path, record)
            option_files.add(path)
            option_rows_written += 1
            ticker = _canonical_ticker(contract.symbol)
            batch_contracts_by_ticker.setdefault(ticker, []).append(_batch_contract_record(record))
            batch_spot_by_ticker[ticker] = discovery.spot if discovery is not None else None

    missing_count = len(contract_by_code) - len(returned_codes)
    if missing_count > 0:
        warnings.append(f"option snapshot missing {missing_count} selected contracts")

    batch_files: set[Path] = set()
    batch_rows_written = 0
    for ticker, contracts in sorted(batch_contracts_by_ticker.items()):
        batch_record = {
            "schema_version": SCHEMA_VERSION,
            "source": "moomoo",
            "record_type": "option_snapshot_batch",
            "capture_id": capture_id,
            "time_utc": time_utc,
            "captured_at_utc": time_utc,
            "time_bucket_utc": time_bucket_utc,
            "timeline_bucket_utc": time_bucket_utc,
            "timeline_seconds": timeline_seconds,
            "market_date": market_date,
            "ticker": ticker,
            "symbol": ticker,
            "expiry": expiry.isoformat(),
            "resolved_spot": batch_spot_by_ticker.get(ticker),
            "contract_count": len(contracts),
            "contracts": contracts,
        }
        path = _batch_records_path(output_dir, "moomoo", market_date, ticker)
        _append_jsonl(path, batch_record)
        batch_files.add(path)
        batch_rows_written += 1

    _append_jsonl(
        _captures_path(output_dir, market_date),
        {
            "schema_version": SCHEMA_VERSION,
            "source": "moomoo",
            "record_type": "capture_summary",
            "capture_id": capture_id,
            "time_utc": time_utc,
            "captured_at_utc": time_utc,
            "time_bucket_utc": time_bucket_utc,
            "timeline_bucket_utc": time_bucket_utc,
            "timeline_seconds": timeline_seconds,
            "market_date": market_date,
            "expiry": expiry.isoformat(),
            "subscription": _jsonable(subscription),
            "option_rows_written": option_rows_written,
            "batch_rows_written": batch_rows_written,
            "underlying_rows_written": underlying_summary.rows_written,
            "selected_contracts": {discovery.symbol: len(discovery.contracts) for discovery in discoveries},
            "tickers": [_canonical_ticker(discovery.symbol) for discovery in discoveries],
            "warnings": warnings,
        },
    )

    return ResearchCaptureSummary(
        capture_id=capture_id,
        time_utc=time_utc,
        captured_at_utc=time_utc,
        time_bucket_utc=time_bucket_utc,
        market_date=market_date,
        expiry=expiry.isoformat(),
        output_dir=str(output_dir),
        option_rows_written=option_rows_written,
        batch_rows_written=batch_rows_written,
        underlying_rows_written=underlying_summary.rows_written,
        selected_contracts={discovery.symbol: len(discovery.contracts) for discovery in discoveries},
        option_files=[str(path) for path in sorted(option_files)],
        batch_files=[str(path) for path in sorted(batch_files)],
        underlying_files=[str(path) for path in sorted(underlying_summary.files)],
        warnings=warnings,
    )


def run_research_recorder_loop(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    output_dir: Path,
    expiry: date | None,
    expiry_provider: ExpiryProvider | None = None,
    interval_seconds_provider: IntervalSecondsProvider | None = None,
    timeline_seconds: int = DEFAULT_TIMELINE_SECONDS,
    max_loops: int | None = None,
) -> ResearchCaptureSummary:
    result: ResearchCaptureSummary | None = None
    loops = 0
    while max_loops is None or loops < max_loops:
        target_expiry = _target_expiry(expiry, expiry_provider)
        started_at = time.perf_counter()
        result = capture_research_snapshot_once(
            client,
            config,
            output_dir=output_dir,
            expiry=target_expiry,
            timeline_seconds=timeline_seconds,
        )
        print(json.dumps(result.as_dict(), separators=(",", ":"), sort_keys=True), flush=True)
        elapsed = time.perf_counter() - started_at
        loops += 1
        if max_loops is None or loops < max_loops:
            interval_seconds = interval_seconds_provider() if interval_seconds_provider else config.refresh_interval_seconds
            time.sleep(max(0, interval_seconds - elapsed))

    if result is None:
        raise RuntimeError("research recorder loop did not run")
    return result


def run_market_hours_recorder_loop(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    output_dir: Path,
    expiry: date | None,
    expiry_provider: ExpiryProvider | None = None,
    interval_seconds_provider: IntervalSecondsProvider | None = None,
    timeline_seconds: int = DEFAULT_TIMELINE_SECONDS,
    max_loops: int | None = None,
    repeat_daily: bool = False,
    now_provider: Callable[[], datetime] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> ResearchCaptureSummary:
    if timeline_seconds <= 0:
        raise ValueError("timeline_seconds must be greater than zero")

    current_time = now_provider or (lambda: datetime.now(UTC))
    sleeper = sleep or time.sleep
    result: ResearchCaptureSummary | None = None
    loops = 0
    completed_session_dates: set[str] = set()

    while max_loops is None or loops < max_loops:
        now = _aware_utc(current_time())
        session = next_regular_session_window(now)
        opens_at = _parse_datetime(session.opens_at_utc)
        closes_at = _parse_datetime(session.closes_at_utc)

        if now < opens_at:
            _print_market_status("waiting_for_market_open", session, now)
            sleeper(min(60.0, max(0.0, (opens_at - now).total_seconds())))
            continue
        if now >= closes_at:
            completed_session_dates.add(session.market_date)
            if not repeat_daily:
                break
            _print_market_status("waiting_for_next_market_day", next_regular_session_window(now + timedelta(seconds=1)), now)
            sleeper(60.0)
            continue

        target_expiry = _target_expiry(expiry, expiry_provider)
        started_at = time.perf_counter()
        result = capture_research_snapshot_once(
            client,
            config,
            output_dir=output_dir,
            expiry=target_expiry,
            timeline_seconds=timeline_seconds,
        )
        print(json.dumps(result.as_dict(), separators=(",", ":"), sort_keys=True), flush=True)
        loops += 1

        now_after_capture = _aware_utc(current_time())
        if now_after_capture >= closes_at:
            completed_session_dates.add(session.market_date)
            if not repeat_daily or (max_loops is not None and loops >= max_loops):
                break
            continue

        interval_seconds = interval_seconds_provider() if interval_seconds_provider else config.refresh_interval_seconds
        elapsed = time.perf_counter() - started_at
        seconds_until_close = max(0.0, (closes_at - now_after_capture).total_seconds())
        sleeper(min(seconds_until_close, max(0.0, interval_seconds - elapsed)))

    if result is None:
        raise RuntimeError("market-hours recorder stopped before any capture")
    return result


def next_regular_session_window(now: datetime | None = None) -> MarketSessionWindow:
    market_now = _aware_utc(now or datetime.now(UTC)).astimezone(MARKET_TIMEZONE)
    session_date = market_now.date()
    if market_now.weekday() >= 5 or market_now.time() >= DEFAULT_MARKET_CLOSE:
        session_date = _next_weekday(session_date + timedelta(days=1))
    opens_at = datetime.combine(session_date, DEFAULT_MARKET_OPEN, MARKET_TIMEZONE).astimezone(UTC)
    closes_at = datetime.combine(session_date, DEFAULT_MARKET_CLOSE, MARKET_TIMEZONE).astimezone(UTC)
    return MarketSessionWindow(
        market_date=session_date.isoformat(),
        opens_at_utc=_format_datetime(opens_at),
        closes_at_utc=_format_datetime(closes_at),
    )


def main(argv: Sequence[str] | None = None, *, client_factory: ClientFactory | None = None) -> None:
    parser = argparse.ArgumentParser(description="Record raw Moomoo 0DTE option snapshots for local ML research.")
    parser.add_argument("--host", default=DEFAULT_MOOMOO_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_MOOMOO_PORT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RESEARCH_OUTPUT_DIR)
    parser.add_argument(
        "--expiry",
        type=_parse_date,
        default=None,
        help="Target option expiry. Defaults to the current/next New York market session.",
    )
    parser.add_argument("--spot", action="append", default=[], help="Manual spot override, for example RUT=2150.")
    parser.add_argument("--interval-seconds", type=float, default=DEFAULT_RESEARCH_INTERVAL_SECONDS)
    parser.add_argument("--timeline-seconds", type=int, default=DEFAULT_TIMELINE_SECONDS)
    parser.add_argument("--max-loops", type=int, default=0, help="Number of loops to run; 0 runs continuously.")
    parser.add_argument(
        "--market-hours",
        action="store_true",
        help="Wait for the next regular 9:30 AM ET session and stop at 4:00 PM ET.",
    )
    parser.add_argument(
        "--repeat-daily",
        action="store_true",
        help="With --market-hours, keep recording each weekday market session.",
    )
    raw_args = list(argv if argv is not None else sys.argv[1:])
    if raw_args[:1] == ["--"]:
        raw_args = raw_args[1:]
    args = parser.parse_args(raw_args)

    client: MoomooQuoteClient | None = None
    try:
        config = MoomooCollectorConfig(
            host=args.host,
            port=args.port,
            refresh_interval_seconds=args.interval_seconds,
            manual_spots=parse_manual_spots(args.spot),
        )
        make_client = client_factory or _create_real_client
        client = make_client(args.host, args.port)
        loop_kwargs = {
            "output_dir": args.output_dir,
            "expiry": args.expiry,
            "expiry_provider": None if args.expiry is not None else resolve_moomoo_target_expiry,
            "interval_seconds_provider": lambda: config.refresh_interval_seconds,
            "timeline_seconds": args.timeline_seconds,
            "max_loops": _normalize_max_loops(args.max_loops),
        }
        if args.market_hours:
            run_market_hours_recorder_loop(
                client,
                config,
                repeat_daily=args.repeat_daily,
                **loop_kwargs,
            )
        else:
            if args.repeat_daily:
                raise ValueError("--repeat-daily requires --market-hours")
            run_research_recorder_loop(
                client,
                config,
                **loop_kwargs,
            )
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1) from exc
    finally:
        if client is not None:
            client.close()


@dataclass(frozen=True)
class _UnderlyingWriteSummary:
    rows_written: int
    files: set[Path]
    warnings: list[str]


def _record_underlying_snapshots(
    *,
    client: MoomooQuoteClient,
    symbols: Sequence[MoomooSymbolConfig],
    discoveries: dict[str, MoomooSymbolDiscoveryResult],
    output_dir: Path,
    capture_id: str,
    captured_at: datetime,
    timeline_bucket: datetime,
    timeline_seconds: int,
    market_date: str,
    expiry: date,
) -> _UnderlyingWriteSummary:
    requested_codes: dict[str, list[tuple[str, str]]] = {}
    for symbol in symbols:
        requested_codes.setdefault(symbol.owner_code, []).append((symbol.symbol, "owner"))
        if symbol.spot_proxy_code:
            requested_codes.setdefault(symbol.spot_proxy_code, []).append((symbol.symbol, "spot_proxy"))

    records_by_code: dict[str, dict[str, object]] = {}
    warnings: list[str] = []
    for provider_code in sorted(requested_codes):
        return_code, snapshot_data = client.get_market_snapshot([provider_code])
        if return_code != RET_OK:
            warnings.append(f"underlying snapshot request failed for {provider_code} with code {return_code}")
            continue
        for raw_record in _records(snapshot_data):
            normalized_record = _normalize_record(raw_record)
            code = str(normalized_record.get("code") or "")
            if code:
                records_by_code[code] = normalized_record

    rows_written = 0
    files: set[Path] = set()
    for provider_code, usages in requested_codes.items():
        raw_record = records_by_code.get(provider_code)
        for symbol, usage in usages:
            ticker = _canonical_ticker(symbol)
            discovery = discoveries.get(symbol)
            time_utc = _format_datetime(captured_at)
            time_bucket_utc = _format_datetime(timeline_bucket)
            record = {
                "schema_version": SCHEMA_VERSION,
                "source": "moomoo",
                "record_type": "underlying_snapshot",
                "capture_id": capture_id,
                "time_utc": time_utc,
                "captured_at_utc": time_utc,
                "time_bucket_utc": time_bucket_utc,
                "timeline_bucket_utc": time_bucket_utc,
                "timeline_seconds": timeline_seconds,
                "market_date": market_date,
                "ticker": ticker,
                "symbol": ticker,
                "expiry": expiry.isoformat(),
                "provider_code": provider_code,
                "usage": usage,
                "resolved_spot": discovery.spot if discovery is not None else None,
                "raw": _jsonable(raw_record or {}),
            }
            path = _records_path(output_dir, "moomoo", "underlyings", market_date, symbol)
            _append_jsonl(path, record)
            rows_written += 1
            files.add(path)

    return _UnderlyingWriteSummary(rows_written=rows_written, files=files, warnings=warnings)


def _option_output_record(
    *,
    raw_record: dict[str, object],
    contract: MoomooContract,
    discovery: MoomooSymbolDiscoveryResult | None,
    capture_id: str,
    captured_at: datetime,
    timeline_bucket: datetime,
    timeline_seconds: int,
    market_date: str,
    expiry: date,
) -> dict[str, object]:
    normalized = normalize_snapshot_record(contract, raw_record)
    ticker = _canonical_ticker(contract.symbol)
    time_utc = _format_datetime(captured_at)
    time_bucket_utc = _format_datetime(timeline_bucket)
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "moomoo",
        "record_type": "option_snapshot",
        "capture_id": capture_id,
        "time_utc": time_utc,
        "captured_at_utc": time_utc,
        "time_bucket_utc": time_bucket_utc,
        "timeline_bucket_utc": time_bucket_utc,
        "timeline_seconds": timeline_seconds,
        "market_date": market_date,
        "ticker": ticker,
        "symbol": ticker,
        "owner_code": contract.owner_code,
        "expiry": expiry.isoformat(),
        "resolved_spot": discovery.spot if discovery is not None else None,
        "option_code": contract.option_code,
        "strike": contract.strike,
        "right": normalized.option_type.lower(),
        "provider_update_time": normalized.snapshot_time,
        "raw": _jsonable(raw_record),
        "normalized": _jsonable(normalized.as_dict()),
    }


def _records_path(output_dir: Path, source: str, family: str, market_date: str, symbol: str) -> Path:
    return output_dir / source / family / f"date={market_date}" / f"ticker={_canonical_ticker(symbol)}" / "records.jsonl"


def _batch_records_path(output_dir: Path, source: str, market_date: str, ticker: str) -> Path:
    return output_dir / source / "batches" / f"date={market_date}" / f"ticker={_canonical_ticker(ticker)}" / "records.jsonl"


def _captures_path(output_dir: Path, market_date: str) -> Path:
    return output_dir / "moomoo" / "captures" / f"date={market_date}" / "captures.jsonl"


def _append_jsonl(path: Path, record: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, separators=(",", ":"), default=_json_default))
        handle.write("\n")


def _batch_contract_record(option_record: dict[str, object]) -> dict[str, object]:
    return {
        "option_code": option_record["option_code"],
        "strike": option_record["strike"],
        "right": option_record["right"],
        "provider_update_time": option_record["provider_update_time"],
        "raw": option_record["raw"],
        "normalized": option_record["normalized"],
    }


def _canonical_ticker(value: str) -> str:
    return value.strip().upper()


def _capture_id(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%S.%fZ")


def _floor_datetime(value: datetime, seconds: int) -> datetime:
    epoch_seconds = int(value.timestamp())
    return datetime.fromtimestamp(epoch_seconds - (epoch_seconds % seconds), tz=UTC)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _jsonable(value: object) -> object:
    if value is None or isinstance(value, str | int | bool):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, datetime):
        return _format_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_jsonable(item) for item in value]
    if hasattr(value, "item"):
        try:
            return _jsonable(value.item())
        except Exception:
            pass
    return str(value)


def _json_default(value: object) -> object:
    return _jsonable(value)


def _parse_date(raw_value: str) -> date:
    return date.fromisoformat(raw_value)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return _aware_utc(parsed)


def _next_weekday(value: date) -> date:
    while value.weekday() >= 5:
        value += timedelta(days=1)
    return value


def _normalize_max_loops(value: int) -> int | None:
    if value < 0:
        raise ValueError("--max-loops must be greater than or equal to 0")
    if value == 0:
        return None
    return value


def _create_real_client(host: str, port: int) -> MoomooQuoteClient:
    try:
        from moomoo import OpenQuoteContext
    except ImportError as exc:
        raise RuntimeError("moomoo-api package is not installed") from exc
    return OpenQuoteContext(host=host, port=port)


def _print_market_status(status: str, session: MarketSessionWindow, now: datetime) -> None:
    print(
        json.dumps(
            {
                "status": status,
                "now_utc": _format_datetime(now),
                "market_date": session.market_date,
                "opens_at_utc": session.opens_at_utc,
                "closes_at_utc": session.closes_at_utc,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()


__all__ = [
    "DEFAULT_RESEARCH_OUTPUT_DIR",
    "DEFAULT_RESEARCH_INTERVAL_SECONDS",
    "MarketSessionWindow",
    "ResearchCaptureSummary",
    "capture_research_snapshot_once",
    "next_regular_session_window",
    "run_market_hours_recorder_loop",
    "run_research_recorder_loop",
    "main",
]
