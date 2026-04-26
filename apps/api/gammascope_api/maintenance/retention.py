from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

from gammascope_api.replay.dependencies import get_replay_repository
from gammascope_api.replay.repository import PostgresReplayRepository
from gammascope_api.saved_views.dependencies import get_saved_view_repository
from gammascope_api.saved_views.repository import PostgresSavedViewRepository

DEFAULT_REPLAY_RETENTION_DAYS = 20
DEFAULT_SAVED_VIEW_RETENTION_DAYS = 90


class RetentionCleanupUnavailable(RuntimeError):
    pass


def cleanup_retention(*, dry_run: bool, now: datetime | None = None) -> dict[str, Any]:
    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    replay_days = _retention_days("GAMMASCOPE_REPLAY_RETENTION_DAYS", DEFAULT_REPLAY_RETENTION_DAYS)
    saved_view_days = _retention_days("GAMMASCOPE_SAVED_VIEW_RETENTION_DAYS", DEFAULT_SAVED_VIEW_RETENTION_DAYS)
    replay_cutoff = current_time - timedelta(days=replay_days)
    saved_view_cutoff = current_time - timedelta(days=saved_view_days)

    replay_repository = get_replay_repository()
    saved_view_repository = get_saved_view_repository()
    _verify_cleanup_repository(replay_repository)
    _verify_cleanup_repository(saved_view_repository)

    try:
        replay_repository.ensure_schema()
        saved_view_repository.ensure_schema()
        if dry_run:
            replay_counts = replay_repository.cleanup_before(replay_cutoff, dry_run=True)
            saved_view_count = saved_view_repository.cleanup_before(saved_view_cutoff, dry_run=True)
        else:
            replay_repository.cleanup_before(replay_cutoff, dry_run=True)
            saved_view_repository.cleanup_before(saved_view_cutoff, dry_run=True)
            if not _can_cleanup_atomically(replay_repository, saved_view_repository):
                raise RetentionCleanupUnavailable("Retention cleanup persistence unavailable")
            replay_counts, saved_view_count = _cleanup_postgres_atomically(
                database_url=replay_repository.database_url,
                replay_cutoff=replay_cutoff,
                saved_view_cutoff=saved_view_cutoff,
            )
    except Exception as exc:
        raise RetentionCleanupUnavailable("Retention cleanup persistence unavailable") from exc

    replay_suffix = "eligible" if dry_run else "deleted"
    saved_view_suffix = "eligible" if dry_run else "deleted"
    return {
        "dry_run": dry_run,
        "retention_days": {
            "replay": replay_days,
            "saved_views": saved_view_days,
        },
        "cutoffs": {
            "replay": _format_datetime(replay_cutoff),
            "saved_views": _format_datetime(saved_view_cutoff),
        },
        "replay": {
            f"snapshots_{replay_suffix}": int(replay_counts["snapshots"]),
            f"sessions_{replay_suffix}": int(replay_counts["sessions"]),
        },
        "saved_views": {
            f"views_{saved_view_suffix}": int(saved_view_count),
        },
    }


def _verify_cleanup_repository(repository: Any) -> None:
    if not callable(getattr(repository, "cleanup_before", None)):
        raise RetentionCleanupUnavailable("Retention cleanup persistence unavailable")


def _can_cleanup_atomically(replay_repository: Any, saved_view_repository: Any) -> bool:
    return (
        isinstance(replay_repository, PostgresReplayRepository)
        and isinstance(saved_view_repository, PostgresSavedViewRepository)
        and replay_repository.database_url == saved_view_repository.database_url
    )


def _cleanup_postgres_atomically(
    *,
    database_url: str,
    replay_cutoff: datetime,
    saved_view_cutoff: datetime,
) -> tuple[dict[str, int], int]:
    import psycopg

    with psycopg.connect(database_url, connect_timeout=2) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*)::INTEGER FROM analytics_snapshots WHERE snapshot_time < %s",
                (replay_cutoff,),
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
                """,
                (replay_cutoff, replay_cutoff),
            )
            sessions_count = int(cursor.fetchone()[0])
            cursor.execute(
                "SELECT COUNT(*)::INTEGER FROM saved_views WHERE created_at < %s",
                (saved_view_cutoff,),
            )
            saved_view_count = int(cursor.fetchone()[0])
            cursor.execute(
                """
                SELECT DISTINCT session_id
                FROM analytics_snapshots
                WHERE snapshot_time < %s
                """,
                (replay_cutoff,),
            )
            affected_session_ids = [str(record[0]) for record in cursor.fetchall()]

            cursor.execute("DELETE FROM saved_views WHERE created_at < %s", (saved_view_cutoff,))
            cursor.execute("DELETE FROM analytics_snapshots WHERE snapshot_time < %s", (replay_cutoff,))
            for session_id in affected_session_ids:
                _refresh_replay_session(cursor, session_id)

    return {"snapshots": snapshots_count, "sessions": sessions_count}, saved_view_count


def _refresh_replay_session(cursor: Any, session_id: str) -> None:
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


def _retention_days(env_name: str, default: int) -> int:
    value = os.environ.get(env_name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(1, parsed)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
