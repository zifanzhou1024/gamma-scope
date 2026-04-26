from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Protocol


class SavedViewRepository(Protocol):
    def ensure_schema(self) -> None:
        ...

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    def list_views(self) -> list[dict[str, Any]]:
        ...

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        view_id_prefix: str | None = None,
    ) -> int:
        ...


class InMemorySavedViewRepository:
    def __init__(self) -> None:
        self._views: dict[str, dict[str, Any]] = {}

    def ensure_schema(self) -> None:
        return None

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = _normalized_view(payload)
        self._views[normalized["view_id"]] = normalized
        return deepcopy(normalized)

    def list_views(self) -> list[dict[str, Any]]:
        return [
            deepcopy(view)
            for view in sorted(
                self._views.values(),
                key=lambda view: (
                    -_parse_datetime(str(view["created_at"])).timestamp(),
                    str(view["name"]),
                    str(view["view_id"]),
                ),
            )
        ]

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        view_id_prefix: str | None = None,
    ) -> int:
        raise RuntimeError("Saved view persistence unavailable")


class PostgresSavedViewRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def ensure_schema(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS saved_views (
                        view_id TEXT PRIMARY KEY,
                        owner_scope TEXT NOT NULL,
                        name TEXT NOT NULL,
                        mode TEXT NOT NULL,
                        payload JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS saved_views_created_name_view_id_idx
                    ON saved_views (created_at DESC, name ASC, view_id ASC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS saved_views_owner_created_idx
                    ON saved_views (owner_scope, created_at DESC)
                    """
                )

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        normalized = _normalized_view(payload)
        created_at = _parse_datetime(str(normalized["created_at"]))

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO saved_views (
                        view_id, owner_scope, name, mode, payload, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (view_id) DO UPDATE
                    SET owner_scope = EXCLUDED.owner_scope,
                        name = EXCLUDED.name,
                        mode = EXCLUDED.mode,
                        payload = EXCLUDED.payload,
                        created_at = EXCLUDED.created_at,
                        updated_at = NOW()
                    RETURNING payload
                    """,
                    (
                        normalized["view_id"],
                        normalized["owner_scope"],
                        normalized["name"],
                        normalized["mode"],
                        _jsonb(normalized),
                        created_at,
                    ),
                )
                record = cursor.fetchone()

        return deepcopy(record[0])

    def list_views(self) -> list[dict[str, Any]]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT payload
                    FROM saved_views
                    ORDER BY created_at DESC, name ASC, view_id ASC
                    """
                )
                records = cursor.fetchall()

        return [deepcopy(record[0]) for record in records]

    def delete_view(self, view_id: str) -> None:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM saved_views WHERE view_id = %s", (view_id,))

    def cleanup_before(
        self,
        cutoff: str | datetime,
        *,
        dry_run: bool,
        view_id_prefix: str | None = None,
    ) -> int:
        self.ensure_schema()
        cutoff_time = _parse_datetime(cutoff) if isinstance(cutoff, str) else cutoff.astimezone(UTC)
        view_id_pattern = f"{view_id_prefix}%" if view_id_prefix is not None else None

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*)::INTEGER
                    FROM saved_views
                    WHERE created_at < %s
                      AND (%s::TEXT IS NULL OR view_id LIKE %s)
                    """,
                    (cutoff_time, view_id_prefix, view_id_pattern),
                )
                views_count = int(cursor.fetchone()[0])
                if not dry_run:
                    cursor.execute(
                        """
                        DELETE FROM saved_views
                        WHERE created_at < %s
                          AND (%s::TEXT IS NULL OR view_id LIKE %s)
                        """,
                        (cutoff_time, view_id_prefix, view_id_pattern),
                    )

        return views_count

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, connect_timeout=2)


def _jsonb(payload: dict[str, Any]) -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb(payload)


def _normalized_view(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(payload)
    normalized["created_at"] = _format_datetime(_parse_datetime(str(normalized["created_at"])))
    return normalized


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
