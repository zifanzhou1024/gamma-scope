from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import UTC, datetime, time
from typing import Any, Protocol

from gammascope_api.heatmap.normalization import NEW_YORK_TZ, five_minute_bucket_start


HEATMAP_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS heatmap_oi_baselines (
    baseline_id BIGSERIAL PRIMARY KEY,
    market_date DATE NOT NULL,
    symbol TEXT NOT NULL,
    trading_class TEXT NOT NULL,
    expiration_date DATE NOT NULL,
    contract_id TEXT NOT NULL,
    open_interest INTEGER NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (market_date, symbol, trading_class, expiration_date, contract_id)
);

CREATE TABLE IF NOT EXISTS heatmap_snapshots (
    heatmap_snapshot_id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    source_snapshot_time TIMESTAMPTZ NOT NULL,
    position_mode TEXT NOT NULL,
    payload JSONB NOT NULL,
    row_count INTEGER NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, source_snapshot_time, position_mode)
);

CREATE TABLE IF NOT EXISTS heatmap_cells (
    heatmap_cell_id BIGSERIAL PRIMARY KEY,
    heatmap_snapshot_id BIGINT NOT NULL REFERENCES heatmap_snapshots(heatmap_snapshot_id) ON DELETE CASCADE,
    strike DOUBLE PRECISION,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS heatmap_bucket_5m (
    bucket_id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    position_mode TEXT NOT NULL,
    heatmap_snapshot_id BIGINT NOT NULL REFERENCES heatmap_snapshots(heatmap_snapshot_id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    row_count INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, bucket_start, position_mode)
);
"""


@dataclass(frozen=True)
class HeatmapOiBaselineRecord:
    market_date: str
    symbol: str
    trading_class: str
    expiration_date: str
    contract_id: str
    open_interest: int
    observed_at: str
    locked: bool = False


class HeatmapRepository(Protocol):
    def ensure_schema(self) -> None:
        ...

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> list[HeatmapOiBaselineRecord]:
        ...

    def oi_baseline(
        self,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> list[HeatmapOiBaselineRecord]:
        ...

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    def latest_bucket(self, session_id: str, bucket_start: str, position_mode: str) -> dict[str, Any] | None:
        ...


class InMemoryHeatmapRepository:
    def __init__(self) -> None:
        self._baselines: dict[tuple[str, str, str, str, str], HeatmapOiBaselineRecord] = {}
        self._snapshots: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._next_snapshot_id = 1

    def ensure_schema(self) -> None:
        return None

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> list[HeatmapOiBaselineRecord]:
        stored_records: list[HeatmapOiBaselineRecord] = []
        for record in records:
            normalized = _normalized_baseline(record)
            key = _baseline_key(normalized)
            existing = self._baselines.get(key)
            if existing is not None and existing.locked:
                stored_records.append(existing)
                continue
            if existing is None or _should_replace_provisional(existing, normalized):
                self._baselines[key] = normalized
            stored_records.append(self._baselines[key])
        return [replace(record) for record in stored_records]

    def oi_baseline(
        self,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> list[HeatmapOiBaselineRecord]:
        records = [
            record
            for key, record in self._baselines.items()
            if key[:4] == (market_date, symbol, trading_class, expiration_date)
        ]
        return [replace(record) for record in sorted(records, key=lambda record: record.contract_id)]

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = _normalized_snapshot_payload(payload)
        key = (
            str(normalized["sessionId"]),
            str(normalized["lastSyncedAt"]),
            str(normalized["positionMode"]),
        )
        row_count = len(normalized.get("rows", []))
        existing = self._snapshots.get(key)
        if existing is None:
            heatmap_snapshot_id = self._next_snapshot_id
            self._next_snapshot_id += 1
        else:
            heatmap_snapshot_id = int(existing["heatmap_snapshot_id"])

        summary = {
            "heatmap_snapshot_id": heatmap_snapshot_id,
            "session_id": key[0],
            "source_snapshot_time": key[1],
            "position_mode": key[2],
            "payload": deepcopy(normalized),
            "row_count": row_count,
        }
        self._snapshots[key] = summary

        bucket_start = five_minute_bucket_start(key[1])
        self._buckets[(key[0], bucket_start, key[2])] = {
            "session_id": key[0],
            "bucket_start": bucket_start,
            "position_mode": key[2],
            "heatmap_snapshot_id": heatmap_snapshot_id,
            "payload": deepcopy(normalized),
            "row_count": row_count,
        }
        return _snapshot_summary(summary)

    def latest_bucket(self, session_id: str, bucket_start: str, position_mode: str) -> dict[str, Any] | None:
        bucket = self._buckets.get((session_id, bucket_start, position_mode))
        if bucket is None:
            return None
        return deepcopy(bucket)


class PostgresHeatmapRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def ensure_schema(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(HEATMAP_SCHEMA_SQL)

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> list[HeatmapOiBaselineRecord]:
        self.ensure_schema()
        stored: list[HeatmapOiBaselineRecord] = []
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for record in records:
                    normalized = _normalized_baseline(record)
                    cursor.execute(
                        """
                        INSERT INTO heatmap_oi_baselines (
                            market_date, symbol, trading_class, expiration_date,
                            contract_id, open_interest, observed_at, locked
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (market_date, symbol, trading_class, expiration_date, contract_id)
                        DO UPDATE
                        SET open_interest = EXCLUDED.open_interest,
                            observed_at = EXCLUDED.observed_at,
                            locked = EXCLUDED.locked,
                            updated_at = NOW()
                        WHERE heatmap_oi_baselines.locked = FALSE
                        RETURNING market_date, symbol, trading_class, expiration_date,
                                  contract_id, open_interest, observed_at, locked
                        """,
                        (
                            normalized.market_date,
                            normalized.symbol,
                            normalized.trading_class,
                            normalized.expiration_date,
                            normalized.contract_id,
                            normalized.open_interest,
                            _parse_datetime(normalized.observed_at),
                            normalized.locked,
                        ),
                    )
                    returned = cursor.fetchone()
                    if returned is None:
                        cursor.execute(
                            """
                            SELECT market_date, symbol, trading_class, expiration_date,
                                   contract_id, open_interest, observed_at, locked
                            FROM heatmap_oi_baselines
                            WHERE market_date = %s
                              AND symbol = %s
                              AND trading_class = %s
                              AND expiration_date = %s
                              AND contract_id = %s
                            """,
                            (
                                normalized.market_date,
                                normalized.symbol,
                                normalized.trading_class,
                                normalized.expiration_date,
                                normalized.contract_id,
                            ),
                        )
                        returned = cursor.fetchone()
                    stored.append(_baseline_from_record(returned))
        return stored

    def oi_baseline(
        self,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> list[HeatmapOiBaselineRecord]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT market_date, symbol, trading_class, expiration_date,
                           contract_id, open_interest, observed_at, locked
                    FROM heatmap_oi_baselines
                    WHERE market_date = %s
                      AND symbol = %s
                      AND trading_class = %s
                      AND expiration_date = %s
                    ORDER BY contract_id ASC
                    """,
                    (market_date, symbol, trading_class, expiration_date),
                )
                records = cursor.fetchall()
        return [_baseline_from_record(record) for record in records]

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        normalized = _normalized_snapshot_payload(payload)
        session_id = str(normalized["sessionId"])
        source_snapshot_time = _parse_datetime(str(normalized["lastSyncedAt"]))
        position_mode = str(normalized["positionMode"])
        row_count = len(normalized.get("rows", []))

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO heatmap_snapshots (
                        session_id, source_snapshot_time, position_mode, payload, row_count
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, source_snapshot_time, position_mode)
                    DO UPDATE
                    SET payload = EXCLUDED.payload,
                        row_count = EXCLUDED.row_count,
                        updated_at = NOW()
                    RETURNING heatmap_snapshot_id, session_id, source_snapshot_time, position_mode, row_count
                    """,
                    (session_id, source_snapshot_time, position_mode, _jsonb(normalized), row_count),
                )
                record = cursor.fetchone()
                heatmap_snapshot_id = int(record[0])
                cursor.execute("DELETE FROM heatmap_cells WHERE heatmap_snapshot_id = %s", (heatmap_snapshot_id,))
                for row in normalized.get("rows", []):
                    cursor.execute(
                        """
                        INSERT INTO heatmap_cells (heatmap_snapshot_id, strike, payload)
                        VALUES (%s, %s, %s)
                        """,
                        (heatmap_snapshot_id, _row_strike(row), _jsonb(row)),
                    )
                bucket_start = _parse_datetime(five_minute_bucket_start(str(normalized["lastSyncedAt"])))
                cursor.execute(
                    """
                    INSERT INTO heatmap_bucket_5m (
                        session_id, bucket_start, position_mode,
                        heatmap_snapshot_id, payload, row_count
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, bucket_start, position_mode)
                    DO UPDATE
                    SET heatmap_snapshot_id = EXCLUDED.heatmap_snapshot_id,
                        payload = EXCLUDED.payload,
                        row_count = EXCLUDED.row_count,
                        updated_at = NOW()
                    """,
                    (
                        session_id,
                        bucket_start,
                        position_mode,
                        heatmap_snapshot_id,
                        _jsonb(normalized),
                        row_count,
                    ),
                )
        return {
            "heatmap_snapshot_id": int(record[0]),
            "session_id": str(record[1]),
            "source_snapshot_time": _format_datetime(record[2]),
            "position_mode": str(record[3]),
            "row_count": int(record[4]),
        }

    def latest_bucket(self, session_id: str, bucket_start: str, position_mode: str) -> dict[str, Any] | None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT session_id, bucket_start, position_mode,
                           heatmap_snapshot_id, payload, row_count
                    FROM heatmap_bucket_5m
                    WHERE session_id = %s
                      AND bucket_start = %s
                      AND position_mode = %s
                    """,
                    (session_id, _parse_datetime(bucket_start), position_mode),
                )
                record = cursor.fetchone()
        if record is None:
            return None
        return {
            "session_id": str(record[0]),
            "bucket_start": _format_datetime(record[1]),
            "position_mode": str(record[2]),
            "heatmap_snapshot_id": int(record[3]),
            "payload": deepcopy(record[4]),
            "row_count": int(record[5]),
        }

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, connect_timeout=2)


def _normalized_baseline(record: HeatmapOiBaselineRecord) -> HeatmapOiBaselineRecord:
    observed_at = _format_datetime(_parse_datetime(record.observed_at))
    return replace(record, observed_at=observed_at, locked=record.locked or _is_lock_time(observed_at))


def _baseline_key(record: HeatmapOiBaselineRecord) -> tuple[str, str, str, str, str]:
    return (
        record.market_date,
        record.symbol,
        record.trading_class,
        record.expiration_date,
        record.contract_id,
    )


def _should_replace_provisional(
    existing: HeatmapOiBaselineRecord,
    incoming: HeatmapOiBaselineRecord,
) -> bool:
    if incoming.locked:
        return True
    return _parse_datetime(incoming.observed_at) >= _parse_datetime(existing.observed_at)


def _is_lock_time(value: str) -> bool:
    observed_new_york = _parse_datetime(value).astimezone(NEW_YORK_TZ)
    return observed_new_york.time() >= time(9, 25)


def _normalized_snapshot_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(payload)
    normalized["lastSyncedAt"] = _format_datetime(_parse_datetime(str(normalized["lastSyncedAt"])))
    return normalized


def _snapshot_summary(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "heatmap_snapshot_id": int(summary["heatmap_snapshot_id"]),
        "session_id": str(summary["session_id"]),
        "source_snapshot_time": str(summary["source_snapshot_time"]),
        "position_mode": str(summary["position_mode"]),
        "row_count": int(summary["row_count"]),
    }


def _baseline_from_record(record: tuple[Any, ...]) -> HeatmapOiBaselineRecord:
    return HeatmapOiBaselineRecord(
        market_date=record[0].isoformat() if hasattr(record[0], "isoformat") else str(record[0]),
        symbol=str(record[1]),
        trading_class=str(record[2]),
        expiration_date=record[3].isoformat() if hasattr(record[3], "isoformat") else str(record[3]),
        contract_id=str(record[4]),
        open_interest=int(record[5]),
        observed_at=_format_datetime(record[6]),
        locked=bool(record[7]),
    )


def _row_strike(row: Any) -> float | None:
    if isinstance(row, dict) and "strike" in row:
        return float(row["strike"])
    if hasattr(row, "strike"):
        return float(row.strike)
    return None


def _jsonb(payload: dict[str, Any]) -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb(payload)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
