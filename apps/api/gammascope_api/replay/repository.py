from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Protocol


class ReplayRepository(Protocol):
    def ensure_schema(self) -> None:
        ...

    def insert_snapshot(self, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        ...

    def update_snapshot(self, snapshot_id: int, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        ...

    def latest_snapshot_summary(self, session_id: str) -> dict[str, Any] | None:
        ...

    def list_sessions(self) -> list[dict[str, Any]]:
        ...

    def nearest_snapshot(self, session_id: str, at: str | None = None) -> dict[str, Any] | None:
        ...

    def replay_snapshots(self, session_id: str, at: str | None = None) -> list[dict[str, Any]]:
        ...

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        session_id_prefix: str | None = None,
    ) -> dict[str, int]:
        ...


class NullReplayRepository:
    def ensure_schema(self) -> None:
        return None

    def insert_snapshot(self, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        return {
            "snapshot_id": 0,
            "session_id": snapshot["session_id"],
            "snapshot_time": snapshot["snapshot_time"],
            "row_count": len(snapshot.get("rows", [])),
        }

    def update_snapshot(self, snapshot_id: int, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        return self.insert_snapshot(snapshot, source=source)

    def latest_snapshot_summary(self, session_id: str) -> dict[str, Any] | None:
        return None

    def list_sessions(self) -> list[dict[str, Any]]:
        return []

    def nearest_snapshot(self, session_id: str, at: str | None = None) -> dict[str, Any] | None:
        return None

    def replay_snapshots(self, session_id: str, at: str | None = None) -> list[dict[str, Any]]:
        return []

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        session_id_prefix: str | None = None,
    ) -> dict[str, int]:
        raise RuntimeError("Replay persistence unavailable")


class PostgresReplayRepository:
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
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analytics_snapshots (
                        snapshot_id BIGSERIAL PRIMARY KEY,
                        session_id TEXT NOT NULL REFERENCES replay_sessions(session_id) ON DELETE CASCADE,
                        snapshot_time TIMESTAMPTZ NOT NULL,
                        payload JSONB NOT NULL,
                        row_count INTEGER NOT NULL,
                        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS analytics_snapshots_session_time_idx
                    ON analytics_snapshots (session_id, snapshot_time DESC)
                    """
                )

    def insert_snapshot(self, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        self.ensure_schema()
        normalized = _normalized_snapshot(snapshot)
        snapshot_time = _parse_datetime(normalized["snapshot_time"])
        row_count = len(normalized.get("rows", []))

        with self._connect() as connection:
            with connection.cursor() as cursor:
                self._upsert_session(cursor, normalized, source=source, snapshot_time=snapshot_time)
                cursor.execute(
                    """
                    INSERT INTO analytics_snapshots (session_id, snapshot_time, payload, row_count)
                    VALUES (%s, %s, %s, %s)
                    RETURNING snapshot_id, session_id, snapshot_time, row_count
                    """,
                    (
                        normalized["session_id"],
                        snapshot_time,
                        _jsonb(normalized),
                        row_count,
                    ),
                )
                record = cursor.fetchone()
                self._refresh_session(cursor, normalized["session_id"])
        return _summary_from_record(record)

    def update_snapshot(self, snapshot_id: int, snapshot: dict[str, Any], *, source: str) -> dict[str, Any]:
        self.ensure_schema()
        normalized = _normalized_snapshot(snapshot)
        snapshot_time = _parse_datetime(normalized["snapshot_time"])
        row_count = len(normalized.get("rows", []))

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT session_id FROM analytics_snapshots WHERE snapshot_id = %s",
                    (snapshot_id,),
                )
                previous_record = cursor.fetchone()
                previous_session_id = str(previous_record[0]) if previous_record else None
                self._upsert_session(cursor, normalized, source=source, snapshot_time=snapshot_time)
                cursor.execute(
                    """
                    UPDATE analytics_snapshots
                    SET session_id = %s,
                        snapshot_time = %s,
                        payload = %s,
                        row_count = %s,
                        captured_at = NOW()
                    WHERE snapshot_id = %s
                    RETURNING snapshot_id, session_id, snapshot_time, row_count
                    """,
                    (
                        normalized["session_id"],
                        snapshot_time,
                        _jsonb(normalized),
                        row_count,
                        snapshot_id,
                    ),
                )
                record = cursor.fetchone()
                if record is not None:
                    if previous_session_id is not None and previous_session_id != normalized["session_id"]:
                        self._refresh_session(cursor, previous_session_id)
                    self._refresh_session(cursor, normalized["session_id"])
        if record is None:
            return self.insert_snapshot(normalized, source=source)
        return _summary_from_record(record)

    def latest_snapshot_summary(self, session_id: str) -> dict[str, Any] | None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT snapshot_id, session_id, snapshot_time, row_count
                    FROM analytics_snapshots
                    WHERE session_id = %s
                    ORDER BY snapshot_time DESC, snapshot_id DESC
                    LIMIT 1
                    """,
                    (session_id,),
                )
                record = cursor.fetchone()
        return _summary_from_record(record) if record else None

    def list_sessions(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT session_id, symbol, expiry, start_time, end_time, snapshot_count, source
                    FROM replay_sessions
                    ORDER BY end_time DESC, session_id
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
                "snapshot_count": record[5],
                "source": record[6],
            }
            for record in records
        ]

    def nearest_snapshot(self, session_id: str, at: str | None = None) -> dict[str, Any] | None:
        self.ensure_schema()
        target_time = _parse_optional_datetime(at)

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if target_time is None:
                    cursor.execute(
                        """
                        SELECT payload
                        FROM analytics_snapshots
                        WHERE session_id = %s
                        ORDER BY snapshot_time DESC, snapshot_id DESC
                        LIMIT 1
                        """,
                        (session_id,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT payload
                        FROM analytics_snapshots
                        WHERE session_id = %s
                        ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot_time - %s))), snapshot_time DESC, snapshot_id DESC
                        LIMIT 1
                        """,
                        (session_id, target_time),
                    )
                record = cursor.fetchone()

        if record is None:
            return None
        return deepcopy(record[0])

    def replay_snapshots(self, session_id: str, at: str | None = None) -> list[dict[str, Any]]:
        self.ensure_schema()
        target_time = _parse_optional_datetime(at)

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if target_time is None:
                    cursor.execute(
                        """
                        SELECT payload
                        FROM analytics_snapshots
                        WHERE session_id = %s
                        ORDER BY snapshot_time ASC, snapshot_id ASC
                        """,
                        (session_id,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT payload
                        FROM analytics_snapshots
                        WHERE session_id = %s
                          AND snapshot_time >= %s
                        ORDER BY snapshot_time ASC, snapshot_id ASC
                        """,
                        (session_id, target_time),
                    )
                records = cursor.fetchall()

        return [deepcopy(record[0]) for record in records]

    def delete_session(self, session_id: str) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        session_id_prefix: str | None = None,
    ) -> dict[str, int]:
        self.ensure_schema()
        cutoff_time = _parse_datetime(cutoff) if isinstance(cutoff, str) else cutoff.astimezone(UTC)
        session_id_pattern = f"{session_id_prefix}%" if session_id_prefix is not None else None

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*)::INTEGER
                    FROM analytics_snapshots
                    WHERE snapshot_time < %s
                      AND (%s::TEXT IS NULL OR session_id LIKE %s)
                    """,
                    (cutoff_time, session_id_prefix, session_id_pattern),
                )
                snapshots_count = int(cursor.fetchone()[0])
                cursor.execute(
                    """
                    SELECT COUNT(*)::INTEGER
                    FROM replay_sessions session
                    WHERE EXISTS (
                        SELECT 1
                        FROM analytics_snapshots snapshot
                        WHERE snapshot.session_id = session.session_id
                          AND snapshot.snapshot_time < %s
                    )
                      AND NOT EXISTS (
                        SELECT 1
                        FROM analytics_snapshots snapshot
                        WHERE snapshot.session_id = session.session_id
                          AND snapshot.snapshot_time >= %s
                    )
                      AND (%s::TEXT IS NULL OR session.session_id LIKE %s)
                    """,
                    (cutoff_time, cutoff_time, session_id_prefix, session_id_pattern),
                )
                sessions_count = int(cursor.fetchone()[0])

                if dry_run:
                    return {"snapshots": snapshots_count, "sessions": sessions_count}

                cursor.execute(
                    """
                    SELECT DISTINCT session_id
                    FROM analytics_snapshots
                    WHERE snapshot_time < %s
                      AND (%s::TEXT IS NULL OR session_id LIKE %s)
                    """,
                    (cutoff_time, session_id_prefix, session_id_pattern),
                )
                affected_session_ids = [str(record[0]) for record in cursor.fetchall()]
                cursor.execute(
                    """
                    DELETE FROM analytics_snapshots
                    WHERE snapshot_time < %s
                      AND (%s::TEXT IS NULL OR session_id LIKE %s)
                    """,
                    (cutoff_time, session_id_prefix, session_id_pattern),
                )
                for session_id in affected_session_ids:
                    self._refresh_session(cursor, session_id)

        return {"snapshots": snapshots_count, "sessions": sessions_count}

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, connect_timeout=2)

    def _upsert_session(
        self,
        cursor: Any,
        snapshot: dict[str, Any],
        *,
        source: str,
        snapshot_time: datetime,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO replay_sessions (
                session_id, symbol, expiry, source, start_time, end_time, snapshot_count
            )
            VALUES (%s, %s, %s, %s, %s, %s, 0)
            ON CONFLICT (session_id) DO UPDATE
            SET symbol = EXCLUDED.symbol,
                expiry = EXCLUDED.expiry,
                source = EXCLUDED.source,
                updated_at = NOW()
            """,
            (
                snapshot["session_id"],
                snapshot["symbol"],
                snapshot["expiry"],
                source,
                snapshot_time,
                snapshot_time,
            ),
        )

    def _refresh_session(self, cursor: Any, session_id: str) -> None:
        cursor.execute(
            """
            SELECT
                MIN(snapshot_time) AS start_time,
                MAX(snapshot_time) AS end_time,
                COUNT(*)::INTEGER AS snapshot_count
            FROM analytics_snapshots
            WHERE session_id = %s
            """,
            (session_id,),
        )
        start_time, end_time, snapshot_count = cursor.fetchone()
        if int(snapshot_count) == 0:
            cursor.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            return

        cursor.execute(
            """
            UPDATE replay_sessions
            SET start_time = %s,
                end_time = %s,
                snapshot_count = %s,
                updated_at = NOW()
            WHERE session_id = %s
            """,
            (start_time, end_time, snapshot_count, session_id),
        )


def _jsonb(payload: dict[str, Any]) -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb(payload)


def _normalized_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(snapshot)
    normalized["snapshot_time"] = _format_datetime(_parse_datetime(str(normalized["snapshot_time"])))
    return normalized


def _summary_from_record(record: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "snapshot_id": int(record[0]),
        "session_id": str(record[1]),
        "snapshot_time": _format_datetime(record[2]),
        "row_count": int(record[3]),
    }


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
