from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from gammascope_api.replay.parquet_reader import QuoteRecord, SnapshotRecord

QUOTE_INSERT_BATCH_SIZE = 5_000


@dataclass(frozen=True)
class ImportRecord:
    import_id: str
    status: str
    snapshots_filename: str
    quotes_filename: str
    snapshots_sha256: str
    quotes_sha256: str
    snapshots_size: int
    quotes_size: int
    snapshots_archive_path: str
    quotes_archive_path: str
    session_id: str | None
    validation_summary: dict[str, Any]
    validation_warnings: list[str]
    validation_errors: list[str]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class ImportedSnapshotHeader:
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
    row_count: int


@dataclass(frozen=True)
class ImportedSnapshotData:
    header: ImportedSnapshotHeader
    quotes: list[QuoteRecord]


class ReplayImportRepository(Protocol):
    def ensure_schema(self) -> None:
        raise NotImplementedError

    def create_import(
        self,
        *,
        snapshots_filename: str,
        quotes_filename: str,
        snapshots_sha256: str,
        quotes_sha256: str,
        snapshots_size: int,
        quotes_size: int,
        snapshots_archive_path: str,
        quotes_archive_path: str,
    ) -> ImportRecord:
        raise NotImplementedError

    def get_import(self, import_id: str) -> ImportRecord:
        raise NotImplementedError

    def save_archive_metadata(
        self,
        import_id: str,
        *,
        snapshots_archive_path: str,
        quotes_archive_path: str,
        snapshots_sha256: str,
        quotes_sha256: str,
        snapshots_size: int,
        quotes_size: int,
    ) -> None:
        raise NotImplementedError

    def save_validation(
        self,
        import_id: str,
        *,
        summary: dict[str, Any],
        warnings: Sequence[str],
        errors: Sequence[str],
    ) -> None:
        raise NotImplementedError

    def mark_validating(self, import_id: str) -> None:
        raise NotImplementedError

    def mark_awaiting_confirmation(self, import_id: str, *, session_id: str) -> None:
        raise NotImplementedError

    def mark_publishing(self, import_id: str) -> None:
        raise NotImplementedError

    def mark_completed(self, import_id: str, *, session_id: str) -> None:
        raise NotImplementedError

    def mark_failed(self, import_id: str, *, errors: Sequence[str]) -> None:
        raise NotImplementedError

    def mark_cancelled(self, import_id: str) -> None:
        raise NotImplementedError

    def publish_import(
        self,
        *,
        import_id: str,
        session_id: str,
        symbol: str,
        expiry: str,
        start_time: str,
        end_time: str,
        snapshots: Sequence[SnapshotRecord],
        quotes: Iterable[QuoteRecord],
    ) -> None:
        raise NotImplementedError

    def list_completed_sessions(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def is_completed_public_session(self, session_id: str) -> bool:
        raise NotImplementedError

    def timestamps(self, session_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def snapshot_by_source_id(self, session_id: str, source_snapshot_id: str) -> ImportedSnapshotData | None:
        raise NotImplementedError

    def nearest_snapshot(self, session_id: str, at: str | None) -> ImportedSnapshotData | None:
        raise NotImplementedError

    def stream_snapshots(
        self,
        session_id: str,
        at: str | None,
        source_snapshot_id: str | None,
    ) -> list[ImportedSnapshotData]:
        raise NotImplementedError

    def find_duplicate_checksum_import(
        self,
        *,
        snapshots_sha256: str,
        quotes_sha256: str,
    ) -> ImportRecord | None:
        raise NotImplementedError

    def find_duplicate_identity_import(
        self,
        *,
        snapshots_filename: str,
        quotes_filename: str,
        snapshots_size: int,
        quotes_size: int,
    ) -> ImportRecord | None:
        raise NotImplementedError


class PostgresReplayImportRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def ensure_schema(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replay_sessions (
                        session_id TEXT PRIMARY KEY,
                        symbol TEXT NOT NULL,
                        expiry TEXT NOT NULL,
                        source TEXT NOT NULL,
                        start_time TIMESTAMPTZ NOT NULL,
                        end_time TIMESTAMPTZ NOT NULL,
                        snapshot_count INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute("ALTER TABLE replay_sessions ADD COLUMN IF NOT EXISTS quote_count INTEGER")
                cursor.execute(
                    "ALTER TABLE replay_sessions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'"
                )
                cursor.execute(
                    """
                    ALTER TABLE replay_sessions
                    ADD COLUMN IF NOT EXISTS timestamp_source TEXT NOT NULL DEFAULT 'estimated'
                    """
                )
                cursor.execute("ALTER TABLE replay_sessions ADD COLUMN IF NOT EXISTS import_id TEXT")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replay_imports (
                        import_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        snapshots_filename TEXT NOT NULL,
                        quotes_filename TEXT NOT NULL,
                        snapshots_sha256 TEXT NOT NULL,
                        quotes_sha256 TEXT NOT NULL,
                        snapshots_size INTEGER NOT NULL,
                        quotes_size INTEGER NOT NULL,
                        snapshots_archive_path TEXT NOT NULL,
                        quotes_archive_path TEXT NOT NULL,
                        session_id TEXT,
                        validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                        validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
                        validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replay_import_snapshots (
                        session_id TEXT NOT NULL,
                        source_snapshot_id TEXT NOT NULL,
                        source_order INTEGER NOT NULL,
                        snapshot_time TIMESTAMPTZ NOT NULL,
                        expiry TEXT NOT NULL,
                        spot DOUBLE PRECISION NOT NULL,
                        pricing_spot DOUBLE PRECISION,
                        forward DOUBLE PRECISION NOT NULL,
                        risk_free_rate DOUBLE PRECISION NOT NULL,
                        t_minutes DOUBLE PRECISION NOT NULL,
                        selected_strike_count INTEGER NOT NULL,
                        valid_mid_contract_count INTEGER NOT NULL,
                        stale_contract_count INTEGER NOT NULL,
                        row_count INTEGER NOT NULL,
                        PRIMARY KEY (session_id, source_snapshot_id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replay_import_quotes (
                        session_id TEXT NOT NULL,
                        source_snapshot_id TEXT NOT NULL,
                        source_order INTEGER NOT NULL,
                        contract_id TEXT NOT NULL,
                        strike DOUBLE PRECISION NOT NULL,
                        "right" TEXT NOT NULL,
                        bid DOUBLE PRECISION,
                        ask DOUBLE PRECISION,
                        mid DOUBLE PRECISION,
                        ibkr_iv DOUBLE PRECISION,
                        open_interest INTEGER,
                        quote_valid BOOLEAN NOT NULL,
                        ln_kf DOUBLE PRECISION,
                        distance_from_atm DOUBLE PRECISION,
                        PRIMARY KEY (session_id, source_snapshot_id, contract_id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS replay_import_snapshots_session_order_idx
                    ON replay_import_snapshots (session_id, source_order)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS replay_import_snapshots_session_time_order_idx
                    ON replay_import_snapshots (session_id, snapshot_time, source_order)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS replay_import_quotes_session_snapshot_order_idx
                    ON replay_import_quotes (session_id, source_snapshot_id, source_order, contract_id)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS replay_imports_checksum_idx
                    ON replay_imports (snapshots_sha256, quotes_sha256, created_at DESC, import_id DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS replay_imports_identity_idx
                    ON replay_imports (
                        snapshots_filename,
                        quotes_filename,
                        snapshots_size,
                        quotes_size,
                        created_at DESC,
                        import_id DESC
                    )
                    """
                )

    def create_import(
        self,
        *,
        snapshots_filename: str,
        quotes_filename: str,
        snapshots_sha256: str,
        quotes_sha256: str,
        snapshots_size: int,
        quotes_size: int,
        snapshots_archive_path: str,
        quotes_archive_path: str,
    ) -> ImportRecord:
        self.ensure_schema()
        import_id = f"import-{uuid4()}"
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO replay_imports (
                        import_id,
                        status,
                        snapshots_filename,
                        quotes_filename,
                        snapshots_sha256,
                        quotes_sha256,
                        snapshots_size,
                        quotes_size,
                        snapshots_archive_path,
                        quotes_archive_path
                    )
                    VALUES (%s, 'uploaded', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                    """,
                    (
                        import_id,
                        snapshots_filename,
                        quotes_filename,
                        snapshots_sha256,
                        quotes_sha256,
                        snapshots_size,
                        quotes_size,
                        snapshots_archive_path,
                        quotes_archive_path,
                    ),
                )
                record = cursor.fetchone()
        return _import_record(record)

    def get_import(self, import_id: str) -> ImportRecord:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM replay_imports WHERE import_id = %s", (import_id,))
                record = cursor.fetchone()
        if record is None:
            raise KeyError(f"Replay import not found: {import_id}")
        return _import_record(record)

    def save_archive_metadata(
        self,
        import_id: str,
        *,
        snapshots_archive_path: str,
        quotes_archive_path: str,
        snapshots_sha256: str,
        quotes_sha256: str,
        snapshots_size: int,
        quotes_size: int,
    ) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET snapshots_archive_path = %s,
                        quotes_archive_path = %s,
                        snapshots_sha256 = %s,
                        quotes_sha256 = %s,
                        snapshots_size = %s,
                        quotes_size = %s,
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (
                        snapshots_archive_path,
                        quotes_archive_path,
                        snapshots_sha256,
                        quotes_sha256,
                        snapshots_size,
                        quotes_size,
                        import_id,
                    ),
                )
                _require_updated(cursor, import_id)

    def save_validation(
        self,
        import_id: str,
        *,
        summary: dict[str, Any],
        warnings: Sequence[str],
        errors: Sequence[str],
    ) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET validation_summary = %s,
                        validation_warnings = %s,
                        validation_errors = %s,
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (_jsonb(dict(summary)), _jsonb(list(warnings)), _jsonb(list(errors)), import_id),
                )
                _require_updated(cursor, import_id)

    def mark_validating(self, import_id: str) -> None:
        self._transition(import_id, expected="uploaded", next_status="validating")

    def mark_awaiting_confirmation(self, import_id: str, *, session_id: str) -> None:
        self._transition(
            import_id,
            expected="validating",
            next_status="awaiting_confirmation",
            session_id=session_id,
        )

    def mark_publishing(self, import_id: str) -> None:
        self._transition(import_id, expected="awaiting_confirmation", next_status="publishing")

    def mark_completed(self, import_id: str, *, session_id: str) -> None:
        self._transition(import_id, expected="publishing", next_status="completed", session_id=session_id)

    def mark_failed(self, import_id: str, *, errors: Sequence[str]) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                record = self._locked_import(cursor, import_id)
                if record.status in {"completed", "cancelled"}:
                    raise ValueError(f"Cannot fail import from status {record.status}")
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET status = 'failed',
                        validation_errors = %s,
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (_jsonb(list(errors)), import_id),
                )

    def mark_cancelled(self, import_id: str) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                record = self._locked_import(cursor, import_id)
                if record.status not in {"uploaded", "validating", "awaiting_confirmation"}:
                    raise ValueError(f"Cannot cancel import from status {record.status}")
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET status = 'cancelled',
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (import_id,),
                )

    def publish_import(
        self,
        *,
        import_id: str,
        session_id: str,
        symbol: str,
        expiry: str,
        start_time: str,
        end_time: str,
        snapshots: Sequence[SnapshotRecord],
        quotes: Iterable[QuoteRecord],
    ) -> None:
        self.ensure_schema()
        snapshot_rows = list(snapshots)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                import_record = self._locked_import(cursor, import_id)
                if import_record.status != "publishing":
                    raise ValueError(
                        f"Invalid import status transition: {import_record.status} -> publish; "
                        "expected awaiting_confirmation -> publishing first"
                    )
                cursor.execute(
                    """
                    INSERT INTO replay_sessions (
                        session_id,
                        symbol,
                        expiry,
                        source,
                        start_time,
                        end_time,
                        snapshot_count,
                        quote_count,
                        visibility,
                        timestamp_source,
                        import_id
                    )
                    VALUES (%s, %s, %s, 'parquet_import', %s, %s, %s, %s, 'public', 'exact', %s)
                    """,
                    (
                        session_id,
                        symbol,
                        expiry,
                        _parse_datetime(start_time),
                        _parse_datetime(end_time),
                        len(snapshot_rows),
                        0,
                        import_id,
                    ),
                )
                for snapshot in snapshot_rows:
                    cursor.execute(
                        """
                        INSERT INTO replay_import_snapshots (
                            session_id,
                            source_snapshot_id,
                            source_order,
                            snapshot_time,
                            expiry,
                            spot,
                            pricing_spot,
                            forward,
                            risk_free_rate,
                            t_minutes,
                            selected_strike_count,
                            valid_mid_contract_count,
                            stale_contract_count,
                            row_count
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            session_id,
                            snapshot.source_snapshot_id,
                            snapshot.source_order,
                            _parse_datetime(snapshot.snapshot_time),
                            snapshot.expiry,
                            snapshot.spot,
                            snapshot.pricing_spot,
                            snapshot.forward,
                            snapshot.risk_free_rate,
                            snapshot.t_minutes,
                            snapshot.selected_strike_count,
                            snapshot.valid_mid_contract_count,
                            snapshot.stale_contract_count,
                            snapshot.row_count if snapshot.row_count is not None else 0,
                        ),
                    )
                quote_count = 0
                quote_batch: list[tuple[Any, ...]] = []
                for quote in quotes:
                    quote_batch.append(_quote_insert_params(session_id, quote))
                    if len(quote_batch) >= QUOTE_INSERT_BATCH_SIZE:
                        cursor.executemany(_INSERT_QUOTE_SQL, quote_batch)
                        quote_count += len(quote_batch)
                        quote_batch = []
                if quote_batch:
                    cursor.executemany(_INSERT_QUOTE_SQL, quote_batch)
                    quote_count += len(quote_batch)
                cursor.execute(
                    """
                    UPDATE replay_sessions
                    SET quote_count = %s,
                        updated_at = NOW()
                    WHERE session_id = %s
                    """,
                    (quote_count, session_id),
                )
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET status = 'completed',
                        session_id = %s,
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (session_id, import_id),
                )

    def list_completed_sessions(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        session.session_id,
                        session.symbol,
                        session.expiry,
                        session.start_time,
                        session.end_time,
                        session.snapshot_count,
                        session.source,
                        session.quote_count,
                        session.visibility,
                        session.timestamp_source,
                        session.import_id
                    FROM replay_sessions session
                    JOIN replay_imports import ON import.import_id = session.import_id
                    WHERE import.status = 'completed'
                      AND session.visibility = 'public'
                    ORDER BY session.end_time DESC, session.session_id
                    """
                )
                records = cursor.fetchall()
        return [
            {
                "session_id": record[0],
                "symbol": record[1],
                "expiry": record[2],
                "start_time": _format_datetime(record[3]),
                "end_time": _format_datetime(record[4]),
                "snapshot_count": int(record[5]),
                "source": record[6],
                "quote_count": int(record[7]) if record[7] is not None else None,
                "visibility": record[8],
                "timestamp_source": record[9],
                "import_id": record[10],
            }
            for record in records
        ]

    def is_completed_public_session(self, session_id: str) -> bool:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM replay_sessions session
                        JOIN replay_imports import ON import.import_id = session.import_id
                        WHERE session.session_id = %s
                          AND session.visibility = 'public'
                          AND import.status = 'completed'
                    )
                    """,
                    (session_id,),
                )
                record = cursor.fetchone()
        return bool(record[0])

    def timestamps(self, session_id: str) -> list[dict[str, Any]]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT source_order, snapshot_time, source_snapshot_id
                    FROM replay_import_snapshots
                    WHERE session_id = %s
                    ORDER BY source_order ASC
                    """,
                    (session_id,),
                )
                records = cursor.fetchall()
        return [
            {
                "index": int(record[0]),
                "snapshot_time": _format_datetime(record[1]),
                "source_snapshot_id": record[2],
            }
            for record in records
        ]

    def snapshot_by_source_id(self, session_id: str, source_snapshot_id: str) -> ImportedSnapshotData | None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM replay_import_snapshots
                    WHERE session_id = %s
                      AND source_snapshot_id = %s
                    """,
                    (session_id, source_snapshot_id),
                )
                snapshot_record = cursor.fetchone()
                if snapshot_record is None:
                    return None
                quotes = self._quotes_for_snapshot(cursor, session_id, source_snapshot_id)
        return ImportedSnapshotData(header=_snapshot_header(snapshot_record), quotes=quotes)

    def nearest_snapshot(self, session_id: str, at: str | None) -> ImportedSnapshotData | None:
        self.ensure_schema()
        target_time = _parse_optional_datetime(at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                if target_time is None:
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                        ORDER BY snapshot_time DESC, source_order DESC
                        LIMIT 1
                        """,
                        (session_id,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                          AND snapshot_time <= %s
                        ORDER BY snapshot_time DESC, source_order ASC
                        LIMIT 1
                        """,
                        (session_id, target_time),
                    )
                    before_record = cursor.fetchone()
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                          AND snapshot_time >= %s
                        ORDER BY snapshot_time ASC, source_order ASC
                        LIMIT 1
                        """,
                        (session_id, target_time),
                    )
                    after_record = cursor.fetchone()
                    snapshot_record = _nearest_import_snapshot_record(
                        [before_record, after_record],
                        target_time,
                    )
                if snapshot_record is None:
                    return None
                quotes = self._quotes_for_snapshot(cursor, session_id, str(snapshot_record[1]))
        return ImportedSnapshotData(header=_snapshot_header(snapshot_record), quotes=quotes)

    def stream_snapshots(
        self,
        session_id: str,
        at: str | None,
        source_snapshot_id: str | None,
    ) -> list[ImportedSnapshotData]:
        self.ensure_schema()
        target_time = _parse_optional_datetime(at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                if source_snapshot_id is not None:
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                          AND source_snapshot_id = %s
                        ORDER BY source_order ASC
                        """,
                        (session_id, source_snapshot_id),
                    )
                elif target_time is None:
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                        ORDER BY source_order ASC
                        """,
                        (session_id,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT *
                        FROM replay_import_snapshots
                        WHERE session_id = %s
                          AND snapshot_time >= %s
                        ORDER BY source_order ASC
                        """,
                        (session_id, target_time),
                    )
                snapshot_records = cursor.fetchall()
                quote_groups = self._quotes_for_snapshots(
                    cursor,
                    session_id,
                    [str(snapshot_record[1]) for snapshot_record in snapshot_records],
                )
                snapshots = [
                    ImportedSnapshotData(
                        header=_snapshot_header(snapshot_record),
                        quotes=quote_groups.get(str(snapshot_record[1]), []),
                    )
                    for snapshot_record in snapshot_records
                ]
        return snapshots

    def find_duplicate_checksum_import(
        self,
        *,
        snapshots_sha256: str,
        quotes_sha256: str,
    ) -> ImportRecord | None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM replay_imports
                    WHERE snapshots_sha256 = %s
                      AND quotes_sha256 = %s
                    ORDER BY (status = 'completed') DESC, created_at DESC, import_id DESC
                    LIMIT 1
                    """,
                    (snapshots_sha256, quotes_sha256),
                )
                record = cursor.fetchone()
        return _import_record(record) if record is not None else None

    def find_duplicate_identity_import(
        self,
        *,
        snapshots_filename: str,
        quotes_filename: str,
        snapshots_size: int,
        quotes_size: int,
    ) -> ImportRecord | None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM replay_imports
                    WHERE snapshots_filename = %s
                      AND quotes_filename = %s
                      AND snapshots_size = %s
                      AND quotes_size = %s
                    ORDER BY created_at DESC, import_id DESC
                    LIMIT 1
                    """,
                    (snapshots_filename, quotes_filename, snapshots_size, quotes_size),
                )
                record = cursor.fetchone()
        return _import_record(record) if record is not None else None

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, connect_timeout=2)

    def _transition(
        self,
        import_id: str,
        *,
        expected: str,
        next_status: str,
        session_id: str | None = None,
    ) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                record = self._locked_import(cursor, import_id)
                if record.status != expected:
                    raise ValueError(
                        f"Invalid import status transition: {record.status} -> {next_status}; "
                        f"expected {expected} -> {next_status}"
                    )
                cursor.execute(
                    """
                    UPDATE replay_imports
                    SET status = %s,
                        session_id = COALESCE(%s, session_id),
                        updated_at = NOW()
                    WHERE import_id = %s
                    """,
                    (next_status, session_id, import_id),
                )

    def _locked_import(self, cursor: Any, import_id: str) -> ImportRecord:
        cursor.execute("SELECT * FROM replay_imports WHERE import_id = %s FOR UPDATE", (import_id,))
        record = cursor.fetchone()
        if record is None:
            raise KeyError(f"Replay import not found: {import_id}")
        return _import_record(record)

    def _quotes_for_snapshot(self, cursor: Any, session_id: str, source_snapshot_id: str) -> list[QuoteRecord]:
        cursor.execute(
            """
            SELECT
                session_id,
                source_snapshot_id,
                source_order,
                contract_id,
                strike,
                "right",
                bid,
                ask,
                mid,
                ibkr_iv,
                open_interest,
                quote_valid,
                ln_kf,
                distance_from_atm
            FROM replay_import_quotes
            WHERE session_id = %s
              AND source_snapshot_id = %s
            ORDER BY source_order ASC, contract_id ASC
            """,
            (session_id, source_snapshot_id),
        )
        return [_quote_record(record) for record in cursor.fetchall()]

    def _quotes_for_snapshots(
        self,
        cursor: Any,
        session_id: str,
        source_snapshot_ids: Sequence[str],
    ) -> dict[str, list[QuoteRecord]]:
        if not source_snapshot_ids:
            return {}
        cursor.execute(
            """
            SELECT
                session_id,
                source_snapshot_id,
                source_order,
                contract_id,
                strike,
                "right",
                bid,
                ask,
                mid,
                ibkr_iv,
                open_interest,
                quote_valid,
                ln_kf,
                distance_from_atm
            FROM replay_import_quotes
            WHERE session_id = %s
              AND source_snapshot_id = ANY(%s::text[])
            ORDER BY source_order ASC, contract_id ASC
            """,
            (session_id, list(source_snapshot_ids)),
        )
        quote_groups: dict[str, list[QuoteRecord]] = {source_snapshot_id: [] for source_snapshot_id in source_snapshot_ids}
        for record in cursor.fetchall():
            quote = _quote_record(record)
            quote_groups.setdefault(quote.source_snapshot_id, []).append(quote)
        return quote_groups


_INSERT_QUOTE_SQL = """
INSERT INTO replay_import_quotes (
    session_id,
    source_snapshot_id,
    source_order,
    contract_id,
    strike,
    "right",
    bid,
    ask,
    mid,
    ibkr_iv,
    open_interest,
    quote_valid,
    ln_kf,
    distance_from_atm
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""


def _quote_insert_params(session_id: str, quote: QuoteRecord) -> tuple[Any, ...]:
    return (
        session_id,
        quote.source_snapshot_id,
        quote.source_order,
        quote.contract_id,
        quote.strike,
        quote.right,
        quote.bid,
        quote.ask,
        quote.mid,
        quote.ibkr_iv,
        quote.open_interest,
        quote.quote_valid,
        quote.ln_kf,
        quote.distance_from_atm,
    )


def _jsonb(payload: Any) -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb(payload)


def _require_updated(cursor: Any, import_id: str) -> None:
    if cursor.rowcount == 0:
        raise KeyError(f"Replay import not found: {import_id}")


def _import_record(record: tuple[Any, ...]) -> ImportRecord:
    return ImportRecord(
        import_id=str(record[0]),
        status=str(record[1]),
        snapshots_filename=str(record[2]),
        quotes_filename=str(record[3]),
        snapshots_sha256=str(record[4]),
        quotes_sha256=str(record[5]),
        snapshots_size=int(record[6]),
        quotes_size=int(record[7]),
        snapshots_archive_path=str(record[8]),
        quotes_archive_path=str(record[9]),
        session_id=str(record[10]) if record[10] is not None else None,
        validation_summary=dict(record[11]),
        validation_warnings=list(record[12]),
        validation_errors=list(record[13]),
        created_at=_format_datetime(record[14]),
        updated_at=_format_datetime(record[15]),
    )


def _snapshot_header(record: tuple[Any, ...]) -> ImportedSnapshotHeader:
    return ImportedSnapshotHeader(
        session_id=str(record[0]),
        source_snapshot_id=str(record[1]),
        source_order=int(record[2]),
        snapshot_time=_format_datetime(record[3]),
        expiry=str(record[4]),
        spot=float(record[5]),
        pricing_spot=float(record[6]) if record[6] is not None else None,
        forward=float(record[7]),
        risk_free_rate=float(record[8]),
        t_minutes=float(record[9]),
        selected_strike_count=int(record[10]),
        valid_mid_contract_count=int(record[11]),
        stale_contract_count=int(record[12]),
        row_count=int(record[13]),
    )


def _nearest_import_snapshot_record(
    records: Sequence[tuple[Any, ...] | None],
    target_time: datetime,
) -> tuple[Any, ...] | None:
    candidates = [record for record in records if record is not None]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda record: (
            abs((record[3].astimezone(UTC) - target_time).total_seconds()),
            int(record[2]),
        ),
    )


def _quote_record(record: tuple[Any, ...]) -> QuoteRecord:
    return QuoteRecord(
        session_id=str(record[0]),
        source_snapshot_id=str(record[1]),
        source_order=int(record[2]),
        contract_id=str(record[3]),
        strike=float(record[4]),
        right=record[5],
        bid=float(record[6]) if record[6] is not None else None,
        ask=float(record[7]) if record[7] is not None else None,
        mid=float(record[8]) if record[8] is not None else None,
        ibkr_iv=float(record[9]) if record[9] is not None else None,
        open_interest=int(record[10]) if record[10] is not None else None,
        quote_valid=bool(record[11]),
        ln_kf=float(record[12]) if record[12] is not None else None,
        distance_from_atm=float(record[13]) if record[13] is not None else None,
    )


def _parse_optional_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return _parse_datetime(value)
    except ValueError:
        return None


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
