from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from math import isfinite
from pathlib import Path
import re
from typing import Any, Literal

import pyarrow as pa
import pyarrow.parquet as pq


SNAPSHOT_REQUIRED_COLUMNS = {
    "snapshot_id",
    "market_time",
    "expiry",
    "spot",
    "pricing_spot",
    "forward_price",
    "risk_free_rate",
    "t_minutes",
}
QUOTE_REQUIRED_COLUMNS = {
    "snapshot_id",
    "market_time",
    "expiry",
    "strike",
    "option_type",
    "bid",
    "ask",
    "mid",
    "iv",
    "quote_valid",
}
SNAPSHOT_OPTIONAL_COLUMNS = {
    "selected_strike_count",
    "valid_mid_contract_count",
    "stale_contract_count",
    "row_count",
}
QUOTE_OPTIONAL_COLUMNS = {"oi", "ln_kf", "distance_from_atm"}
QUOTE_SCAN_COLUMNS = QUOTE_REQUIRED_COLUMNS | QUOTE_OPTIONAL_COLUMNS
DEFAULT_QUOTE_BATCH_SIZE = 50_000
MAX_ERROR_EXAMPLE_ROWS = 5
TIMESTAMP_TEXT_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(?P<fraction>\d+))?(?:Z|[+-]\d{2}:\d{2})?$"
)


@dataclass(frozen=True)
class SnapshotRecord:
    session_id: str
    source_snapshot_id: str
    source_order: int
    snapshot_time: str
    expiry: str
    spot: float
    pricing_spot: float | None
    forward: float
    risk_free_rate: float
    t_minutes: float
    selected_strike_count: int
    valid_mid_contract_count: int
    stale_contract_count: int
    row_count: int | None


@dataclass(frozen=True)
class QuoteRecord:
    session_id: str
    source_snapshot_id: str
    source_order: int
    contract_id: str
    strike: float
    right: Literal["call", "put"]
    bid: float | None
    ask: float | None
    mid: float | None
    ibkr_iv: float | None
    open_interest: int | None
    quote_valid: bool
    ln_kf: float | None
    distance_from_atm: float | None


@dataclass(frozen=True)
class ReplayParquetReadResult:
    snapshots: list[SnapshotRecord]
    quotes: list[QuoteRecord]
    snapshot_id_map: dict[str, SnapshotRecord]
    summary: dict[str, Any]
    warnings: list[str]
    errors: list[str]


@dataclass
class _QuoteScanStats:
    quote_count: int
    valid_quote_count: int
    invalid_quote_count: int
    quote_expiries: set[str]
    quote_snapshot_ids: set[str]
    quote_counts_by_snapshot: dict[str, int]
    valid_quote_counts_by_snapshot: dict[str, int]
    strike_values_by_snapshot: dict[str, set[float]]


class _NonFiniteNumericError(ValueError):
    pass


@dataclass
class _LimitedError:
    count: int
    rows: list[int]
    single_message: str
    summary_template: str


class _ValidationErrorLimiter:
    def __init__(self, errors: list[str]) -> None:
        self._errors = errors
        self._limited_errors: dict[str, _LimitedError] = {}

    def add(self, key: str, row_index: int, single_message: str, summary_template: str) -> None:
        limited_error = self._limited_errors.get(key)
        if limited_error is None:
            self._limited_errors[key] = _LimitedError(
                count=1,
                rows=[row_index],
                single_message=single_message,
                summary_template=summary_template,
            )
            return
        limited_error.count += 1
        if len(limited_error.rows) < MAX_ERROR_EXAMPLE_ROWS:
            limited_error.rows.append(row_index)

    def flush(self) -> None:
        for limited_error in self._limited_errors.values():
            if limited_error.count == 1:
                self._errors.append(limited_error.single_message)
                continue
            rows = ", ".join(str(row) for row in limited_error.rows)
            self._errors.append(limited_error.summary_template.format(count=limited_error.count, rows=rows))


def read_replay_parquet_pair(
    *,
    snapshots_path: Path,
    quotes_path: Path,
    session_id: str,
    load_quotes: bool = False,
) -> ReplayParquetReadResult:
    errors: list[str] = []
    warnings: list[str] = []

    snapshots_table = _read_table(Path(snapshots_path), "snapshots.parquet", errors)
    quotes_file = _open_parquet_file(Path(quotes_path), "quotes.parquet", errors)
    if errors or snapshots_table is None or quotes_file is None:
        return _failed(errors)

    snapshot_columns = set(snapshots_table.schema.names)
    quote_columns = set(quotes_file.schema_arrow.names)
    _require_columns("snapshots.parquet", SNAPSHOT_REQUIRED_COLUMNS, snapshot_columns, errors)
    _require_columns("quotes.parquet", QUOTE_REQUIRED_COLUMNS, quote_columns, errors)
    if errors:
        return _failed(errors)

    try:
        source_snapshots = snapshots_table.to_pylist()
    except Exception as exc:
        return _failed([f"Unable to convert snapshots.parquet rows: {exc}"])
    if not source_snapshots:
        return _failed(["No snapshot rows found in snapshots.parquet"])

    snapshot_expiries: set[str] = set()
    snapshot_ids: list[str] = []
    snapshot_times: list[str] = []
    for index, row in enumerate(source_snapshots):
        _validate_snapshot_row(row, index, errors)
        source_id = _source_id_or_none(row.get("snapshot_id"))
        if source_id is not None:
            snapshot_ids.append(source_id)
        expiry = _parse_expiry_value(row.get("expiry"), table_name="snapshots.parquet", row_index=index, errors=errors)
        if expiry is not None:
            snapshot_expiries.add(expiry)
        snapshot_time = _optional_iso_time(row.get("market_time"))
        if snapshot_time is not None:
            snapshot_times.append(snapshot_time)

    if len(snapshot_expiries) != 1:
        errors.append("snapshots.parquet contains multiple expiries")
    duplicate_snapshot_ids = _duplicates(snapshot_ids)
    if duplicate_snapshot_ids:
        errors.append("duplicate snapshot_id values in snapshots.parquet: " + ", ".join(duplicate_snapshot_ids[:5]))

    duplicate_market_times = _duplicates(snapshot_times)
    if duplicate_market_times:
        warnings.append("duplicate market_time values in snapshots.parquet: " + ", ".join(duplicate_market_times[:5]))

    quote_stats = _scan_quotes(quotes_file=quotes_file, quote_columns=quote_columns, errors=errors)
    if len(quote_stats.quote_expiries) != 1:
        errors.append("quotes.parquet contains multiple expiries")
    if snapshot_expiries and quote_stats.quote_expiries and snapshot_expiries != quote_stats.quote_expiries:
        errors.append("expiry mismatch between snapshots.parquet and quotes.parquet")

    missing_snapshot_ids = sorted(quote_stats.quote_snapshot_ids - set(snapshot_ids))
    if missing_snapshot_ids:
        errors.append("quote snapshot_id values without snapshot rows: " + ", ".join(missing_snapshot_ids[:5]))

    if quote_stats.valid_quote_count == 0:
        errors.append("No valid quote rows found in quotes.parquet")
    if quote_stats.invalid_quote_count:
        warnings.append(f"{quote_stats.invalid_quote_count} invalid quote rows found")

    if errors:
        return _failed(errors, warnings)

    expiry = next(iter(snapshot_expiries))
    snapshots = [
        _normalize_snapshot(
            row=row,
            source_order=index,
            session_id=session_id,
            expiry=expiry,
            quote_count=quote_stats.quote_counts_by_snapshot.get(snapshot_ids[index], 0),
            valid_quote_count=quote_stats.valid_quote_counts_by_snapshot.get(snapshot_ids[index], 0),
            strike_count=len(quote_stats.strike_values_by_snapshot.get(snapshot_ids[index], set())),
        )
        for index, row in enumerate(source_snapshots)
    ]
    snapshot_id_map = {snapshot.source_snapshot_id: snapshot for snapshot in snapshots}
    quotes = (
        list(
            iter_replay_quote_records(
                quotes_path=Path(quotes_path),
                snapshot_id_map=snapshot_id_map,
                session_id=session_id,
                expiry=expiry,
            )
        )
        if load_quotes
        else []
    )

    summary = {
        "expiry": expiry,
        "snapshot_count": len(snapshots),
        "quote_count": quote_stats.quote_count,
        "valid_quote_count": quote_stats.valid_quote_count,
        "invalid_quote_count": quote_stats.invalid_quote_count,
        "quote_rows_per_snapshot": _quote_rows_per_snapshot(snapshot_ids, quote_stats.quote_counts_by_snapshot),
        "source_row_count_profile": [snapshot.row_count for snapshot in snapshots],
        "snapshot_previews": _snapshot_previews(snapshots),
    }
    return ReplayParquetReadResult(
        snapshots=snapshots,
        quotes=quotes,
        snapshot_id_map=snapshot_id_map,
        summary=summary,
        warnings=warnings,
        errors=[],
    )


def iter_replay_quote_records(
    *,
    quotes_path: Path,
    snapshot_id_map: Mapping[str, SnapshotRecord],
    session_id: str,
    expiry: str,
) -> Iterator[QuoteRecord]:
    parquet_file = pq.ParquetFile(quotes_path)
    quote_columns = set(parquet_file.schema_arrow.names)
    columns = [column for column in QUOTE_SCAN_COLUMNS if column in quote_columns]
    for batch in parquet_file.iter_batches(batch_size=DEFAULT_QUOTE_BATCH_SIZE, columns=columns):
        yield from normalize_quote_batch(
            batch,
            snapshot_id_map=snapshot_id_map,
            session_id=session_id,
            expiry=expiry,
        )


def normalize_quote_batch(
    batch: pa.RecordBatch,
    *,
    snapshot_id_map: Mapping[str, SnapshotRecord],
    session_id: str,
    expiry: str,
) -> Iterator[QuoteRecord]:
    for row in batch.to_pylist():
        source_snapshot_id = _source_id_or_none(row.get("snapshot_id"))
        if source_snapshot_id is None:
            continue
        snapshot = snapshot_id_map[source_snapshot_id]
        yield _normalize_quote(row=row, snapshot=snapshot, session_id=session_id, expiry=expiry)


def _read_table(path: Path, label: str, errors: list[str]) -> pa.Table | None:
    try:
        return pq.read_table(path)
    except Exception as exc:
        errors.append(f"Unable to read {label}: {exc}")
        return None


def _open_parquet_file(path: Path, label: str, errors: list[str]) -> pq.ParquetFile | None:
    try:
        return pq.ParquetFile(path)
    except Exception as exc:
        errors.append(f"Unable to read {label}: {exc}")
        return None


def _scan_quotes(
    *,
    quotes_file: pq.ParquetFile,
    quote_columns: set[str],
    errors: list[str],
) -> _QuoteScanStats:
    stats = _QuoteScanStats(
        quote_count=0,
        valid_quote_count=0,
        invalid_quote_count=0,
        quote_expiries=set(),
        quote_snapshot_ids=set(),
        quote_counts_by_snapshot={},
        valid_quote_counts_by_snapshot={},
        strike_values_by_snapshot={},
    )
    columns = [column for column in QUOTE_SCAN_COLUMNS if column in quote_columns]
    quote_errors = _ValidationErrorLimiter(errors)
    try:
        for batch in quotes_file.iter_batches(batch_size=DEFAULT_QUOTE_BATCH_SIZE, columns=columns):
            rows = batch.to_pylist()
            row_offset = stats.quote_count
            for index, row in enumerate(rows):
                row_index = row_offset + index
                stats.quote_count += 1
                _validate_quote_row(row, row_index, quote_errors)

                try:
                    expiry = _date_string(row.get("expiry"))
                except (TypeError, ValueError):
                    quote_errors.add(
                        "quotes.parquet:expiry:invalid",
                        row_index,
                        f"quotes.parquet row {row_index} invalid expiry value for expiry: {row.get('expiry')!r}",
                        "quotes.parquet invalid expiry in {count} rows; example rows: {rows}",
                    )
                    expiry = None
                if expiry is not None:
                    stats.quote_expiries.add(expiry)

                snapshot_id = _source_id_or_none(row.get("snapshot_id"))
                if snapshot_id is None:
                    continue
                stats.quote_snapshot_ids.add(snapshot_id)
                stats.quote_counts_by_snapshot[snapshot_id] = stats.quote_counts_by_snapshot.get(snapshot_id, 0) + 1

                if _is_valid_quote(row):
                    stats.valid_quote_count += 1
                    stats.valid_quote_counts_by_snapshot[snapshot_id] = (
                        stats.valid_quote_counts_by_snapshot.get(snapshot_id, 0) + 1
                    )
                else:
                    stats.invalid_quote_count += 1

                strike = _finite_float_or_none(row.get("strike"))
                if strike is not None:
                    stats.strike_values_by_snapshot.setdefault(snapshot_id, set()).add(strike)
    except Exception as exc:
        errors.append(f"Unable to scan quotes.parquet: {exc}")
    quote_errors.flush()
    return stats


def _require_columns(label: str, required: set[str], actual: set[str], errors: list[str]) -> None:
    missing = sorted(required - actual)
    if missing:
        errors.append(f"{label} missing required columns: {', '.join(missing)}")


def _validate_snapshot_row(row: dict[str, Any], row_index: int, errors: list[str]) -> None:
    _validate_required_source_id(row.get("snapshot_id"), "snapshots.parquet", row_index, errors)
    _validate_required_timestamp(row.get("market_time"), "snapshots.parquet", "market_time", row_index, errors)
    for column in ("spot", "forward_price", "risk_free_rate", "t_minutes"):
        _validate_required_numeric(row.get(column), "snapshots.parquet", column, row_index, errors)
    _validate_optional_numeric(row.get("pricing_spot"), "snapshots.parquet", "pricing_spot", row_index, errors)
    for column in SNAPSHOT_OPTIONAL_COLUMNS:
        _validate_optional_int(row.get(column), "snapshots.parquet", column, row_index, errors)


def _validate_quote_row(row: dict[str, Any], row_index: int, errors: _ValidationErrorLimiter) -> None:
    _validate_required_source_id(row.get("snapshot_id"), "quotes.parquet", row_index, errors)
    _validate_required_timestamp(row.get("market_time"), "quotes.parquet", "market_time", row_index, errors)
    option_type = str(row.get("option_type", "")).strip().lower()
    if option_type not in {"c", "call", "p", "put"}:
        errors.add(
            "quotes.parquet:option_type:invalid",
            row_index,
            f"quotes.parquet row {row_index} invalid option_type: {row.get('option_type')!r}",
            "quotes.parquet invalid option_type in {count} rows; example rows: {rows}",
        )
    _validate_required_numeric(row.get("strike"), "quotes.parquet", "strike", row_index, errors)
    _validate_required_bool(row.get("quote_valid"), "quotes.parquet", "quote_valid", row_index, errors)
    for column in ("bid", "ask", "mid", "iv", "ln_kf", "distance_from_atm"):
        _validate_optional_numeric(row.get(column), "quotes.parquet", column, row_index, errors)
    _validate_optional_int(row.get("oi"), "quotes.parquet", "oi", row_index, errors)


def _failed(errors: list[str], warnings: list[str] | None = None) -> ReplayParquetReadResult:
    return ReplayParquetReadResult(
        snapshots=[],
        quotes=[],
        snapshot_id_map={},
        summary={},
        warnings=warnings or [],
        errors=errors,
    )


def _parse_expiry_value(
    value: Any,
    *,
    table_name: str,
    row_index: int,
    errors: list[str],
) -> str | None:
    try:
        return _date_string(value)
    except (TypeError, ValueError):
        errors.append(f"{table_name} row {row_index} invalid expiry value for expiry: {value!r}")
        return None


def _date_string(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        raise ValueError("missing expiry")
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return date(int(text[:4]), int(text[4:6]), int(text[6:])).isoformat()
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return date.fromisoformat(text).isoformat()
    raise ValueError(f"invalid expiry value: {value!r}")


def _iso_time(value: Any) -> str:
    if isinstance(value, datetime):
        timestamp = value
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=UTC)
        timestamp = timestamp.astimezone(UTC)
        return timestamp.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        raise ValueError(f"timestamp must include an explicit time component: {value!r}")
    text = str(value).strip()
    match = TIMESTAMP_TEXT_PATTERN.fullmatch(text)
    if match is None:
        raise ValueError(f"timestamp must be an ISO datetime with seconds: {value!r}")
    fraction = match.group("fraction")
    if fraction is not None and len(fraction) > 6:
        raise ValueError(f"timestamp precision finer than microseconds: {value!r}")
    if text.endswith("Z"):
        timestamp = datetime.fromisoformat(text[:-1] + "+00:00")
    else:
        timestamp = datetime.fromisoformat(text)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    timestamp = timestamp.astimezone(UTC)
    return timestamp.isoformat().replace("+00:00", "Z")


def _optional_iso_time(value: Any) -> str | None:
    try:
        return _iso_time(value)
    except (TypeError, ValueError):
        return None


def _validate_required_source_id(
    value: Any,
    table_name: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    if value is None:
        _add_validation_error(
            errors,
            f"{table_name}:snapshot_id:missing",
            row_index,
            f"{table_name} row {row_index} missing snapshot_id",
            f"{table_name} missing snapshot_id in {{count}} rows; example rows: {{rows}}",
        )
        return
    if _source_id_or_none(value) is None:
        _add_validation_error(
            errors,
            f"{table_name}:snapshot_id:blank",
            row_index,
            f"{table_name} row {row_index} blank snapshot_id",
            f"{table_name} blank snapshot_id in {{count}} rows; example rows: {{rows}}",
        )


def _source_id_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text


def _validate_required_timestamp(
    value: Any,
    table_name: str,
    column: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    if value is None:
        _add_validation_error(
            errors,
            f"{table_name}:{column}:missing_timestamp",
            row_index,
            f"{table_name} row {row_index} missing required timestamp value for {column}",
            f"{table_name} missing {column} timestamp in {{count}} rows; example rows: {{rows}}",
        )
        return
    try:
        _iso_time(value)
    except (TypeError, ValueError) as exc:
        _add_validation_error(
            errors,
            f"{table_name}:{column}:invalid_timestamp",
            row_index,
            f"{table_name} row {row_index} invalid timestamp value for {column}: {value!r} ({exc})",
            f"{table_name} invalid {column} timestamp in {{count}} rows; example rows: {{rows}}",
        )


def _validate_required_bool(
    value: Any,
    table_name: str,
    column: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    try:
        _parse_bool(value)
    except (TypeError, ValueError):
        _add_validation_error(
            errors,
            f"{table_name}:{column}:invalid_bool",
            row_index,
            f"{table_name} row {row_index} invalid boolean value for {column}: {value!r}",
            f"{table_name} invalid {column} boolean in {{count}} rows; example rows: {{rows}}",
        )


def _validate_required_numeric(
    value: Any,
    table_name: str,
    column: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    if value is None:
        _add_validation_error(
            errors,
            f"{table_name}:{column}:missing_numeric",
            row_index,
            f"{table_name} row {row_index} missing required numeric value for {column}",
            f"{table_name} missing {column} numeric value in {{count}} rows; example rows: {{rows}}",
        )
        return
    _validate_optional_numeric(value, table_name, column, row_index, errors)


def _validate_optional_numeric(
    value: Any,
    table_name: str,
    column: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    if value is None:
        return
    try:
        _parse_finite_float(value)
    except _NonFiniteNumericError:
        _add_validation_error(
            errors,
            f"{table_name}:{column}:non_finite_numeric",
            row_index,
            f"{table_name} row {row_index} non-finite numeric value for {column}: {value!r}",
            f"{table_name} non-finite {column} numeric value in {{count}} rows; example rows: {{rows}}",
        )
    except (TypeError, ValueError):
        _add_validation_error(
            errors,
            f"{table_name}:{column}:invalid_numeric",
            row_index,
            f"{table_name} row {row_index} invalid numeric value for {column}: {value!r}",
            f"{table_name} invalid {column} numeric value in {{count}} rows; example rows: {{rows}}",
        )


def _validate_optional_int(
    value: Any,
    table_name: str,
    column: str,
    row_index: int,
    errors: list[str] | _ValidationErrorLimiter,
) -> None:
    if value is None:
        return
    try:
        _parse_int(value)
    except (TypeError, ValueError):
        _add_validation_error(
            errors,
            f"{table_name}:{column}:invalid_integer",
            row_index,
            f"{table_name} row {row_index} invalid integer value for {column}: {value!r}",
            f"{table_name} invalid {column} integer in {{count}} rows; example rows: {{rows}}",
        )


def _add_validation_error(
    errors: list[str] | _ValidationErrorLimiter,
    key: str,
    row_index: int,
    single_message: str,
    summary_template: str,
) -> None:
    if isinstance(errors, _ValidationErrorLimiter):
        errors.add(key, row_index, single_message, summary_template)
    else:
        errors.append(single_message)


def _normalize_snapshot(
    *,
    row: dict[str, Any],
    source_order: int,
    session_id: str,
    expiry: str,
    quote_count: int,
    valid_quote_count: int,
    strike_count: int,
) -> SnapshotRecord:
    pricing_spot = _positive_optional_float(row.get("pricing_spot"))
    stale_count = quote_count - valid_quote_count
    return SnapshotRecord(
        session_id=session_id,
        source_snapshot_id=_source_id_or_none(row["snapshot_id"]) or "",
        source_order=source_order,
        snapshot_time=_iso_time(row["market_time"]),
        expiry=expiry,
        spot=pricing_spot if pricing_spot is not None else _float(row["spot"]),
        pricing_spot=pricing_spot,
        forward=_float(row["forward_price"]),
        risk_free_rate=_float(row["risk_free_rate"]),
        t_minutes=_float(row["t_minutes"]),
        selected_strike_count=_optional_int(row.get("selected_strike_count"), strike_count),
        valid_mid_contract_count=_optional_int(row.get("valid_mid_contract_count"), valid_quote_count),
        stale_contract_count=_optional_int(row.get("stale_contract_count"), stale_count),
        row_count=_optional_int_or_none(row.get("row_count")),
    )


def _normalize_quote(
    *,
    row: dict[str, Any],
    snapshot: SnapshotRecord,
    session_id: str,
    expiry: str,
) -> QuoteRecord:
    right = _right(row["option_type"])
    strike = _float(row["strike"])
    if right not in {"call", "put"}:
        raise ValueError(f"invalid option_type: {row['option_type']!r}")
    return QuoteRecord(
        session_id=session_id,
        source_snapshot_id=snapshot.source_snapshot_id,
        source_order=snapshot.source_order,
        contract_id=f"SPXW-{expiry}-{right[0].upper()}-{_format_strike(strike)}",
        strike=strike,
        right=right,
        bid=_optional_float(row.get("bid")),
        ask=_optional_float(row.get("ask")),
        mid=_optional_float(row.get("mid")),
        ibkr_iv=_optional_float(row.get("iv")),
        open_interest=_optional_int_or_none(row.get("oi")),
        quote_valid=_is_valid_quote(row),
        ln_kf=_optional_float(row.get("ln_kf")),
        distance_from_atm=_optional_float(row.get("distance_from_atm")),
    )


def _snapshot_previews(snapshots: list[SnapshotRecord]) -> list[dict[str, Any]]:
    indexes = sorted({0, len(snapshots) // 2, len(snapshots) - 1})
    return [
        {
            "source_snapshot_id": snapshots[index].source_snapshot_id,
            "source_order": snapshots[index].source_order,
            "snapshot_time": snapshots[index].snapshot_time,
            "row_count": snapshots[index].row_count,
        }
        for index in indexes
        if index >= 0
    ]


def _quote_rows_per_snapshot(snapshot_ids: list[str], quote_counts_by_snapshot: dict[str, int]) -> int | dict[str, int]:
    counts = {snapshot_id: quote_counts_by_snapshot.get(snapshot_id, 0) for snapshot_id in snapshot_ids}
    unique_counts = set(counts.values())
    if len(unique_counts) == 1:
        return unique_counts.pop()
    return counts


def _duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def _right(value: Any) -> str:
    text = str(value).strip().lower()
    if text in {"c", "call"}:
        return "call"
    if text in {"p", "put"}:
        return "put"
    return text


def _is_valid_quote(row: dict[str, Any]) -> bool:
    return (
        _optional_bool(row.get("quote_valid")) is True
        and row.get("bid") is not None
        and row.get("ask") is not None
        and row.get("mid") is not None
    )


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float) and not isinstance(value, bool):
        numeric = float(value)
        if numeric == 1.0:
            return True
        if numeric == 0.0:
            return False
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1"}:
            return True
        if text in {"false", "0"}:
            return False
    raise ValueError(f"invalid boolean value: {value!r}")


def _optional_bool(value: Any) -> bool | None:
    try:
        return _parse_bool(value)
    except (TypeError, ValueError):
        return None


def _float(value: Any) -> float:
    return _parse_finite_float(value)


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return _parse_finite_float(value)


def _positive_optional_float(value: Any) -> float | None:
    numeric = _optional_float(value)
    if numeric is None or numeric <= 0 or not isfinite(numeric):
        return None
    return numeric


def _finite_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return _parse_finite_float(value)
    except (TypeError, ValueError):
        return None


def _parse_finite_float(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError(f"invalid numeric value: {value!r}")
    numeric = float(value)
    if not isfinite(numeric):
        raise _NonFiniteNumericError(f"non-finite numeric value: {value!r}")
    return numeric


def _optional_int(value: Any, default: int) -> int:
    if value is None:
        return default
    return _parse_int(value)


def _optional_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    return _parse_int(value)


def _parse_int(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError(f"invalid integer value: {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if isfinite(value) and value.is_integer():
            return int(value)
        raise ValueError(f"invalid integer value: {value!r}")
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"[+-]?\d+", text) is not None:
            return int(text)
    raise ValueError(f"invalid integer value: {value!r}")


def _format_strike(strike: float) -> str:
    if strike.is_integer():
        return str(int(strike))
    return f"{strike:g}"
