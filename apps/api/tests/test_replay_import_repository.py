from __future__ import annotations

from uuid import uuid4

import pytest

from gammascope_api.replay.import_repository import PostgresReplayImportRepository
from gammascope_api.replay.parquet_reader import QuoteRecord, SnapshotRecord


TEST_DATABASE_URL = "postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope"


@pytest.fixture()
def import_repository() -> tuple[PostgresReplayImportRepository, list[str], list[str]]:
    repo = PostgresReplayImportRepository(TEST_DATABASE_URL)
    try:
        repo.ensure_schema()
    except Exception as exc:
        pytest.skip(f"Postgres replay import persistence is unavailable: {exc}")

    import_ids: list[str] = []
    session_ids: list[str] = []
    yield repo, import_ids, session_ids

    _cleanup_created_records(session_ids=session_ids, import_ids=import_ids)


def test_ensure_schema_creates_import_tables_and_extends_replay_sessions(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, _import_ids, _session_ids = import_repository

    repo.ensure_schema()

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('replay_imports', 'replay_import_snapshots', 'replay_import_quotes')
                """
            )
            tables = {record[0] for record in cursor.fetchall()}
            cursor.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'replay_sessions'
                  AND column_name IN ('timestamp_source', 'quote_count', 'visibility', 'import_id')
                """
            )
            columns = {record[0] for record in cursor.fetchall()}

    assert tables == {"replay_imports", "replay_import_snapshots", "replay_import_quotes"}
    assert columns == {"timestamp_source", "quote_count", "visibility", "import_id"}


def test_create_import_returns_uploaded_status_and_duplicate_queries_find_existing_import(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, _session_ids = import_repository

    record = repo.create_import(
        snapshots_filename="snapshots.parquet",
        quotes_filename="quotes.parquet",
        snapshots_sha256="snap-sha",
        quotes_sha256="quote-sha",
        snapshots_size=123,
        quotes_size=456,
        snapshots_archive_path="/archive/import/snapshots.parquet",
        quotes_archive_path="/archive/import/quotes.parquet",
    )
    import_ids.append(record.import_id)

    checksum_duplicate = repo.find_duplicate_checksum_import(
        snapshots_sha256="snap-sha",
        quotes_sha256="quote-sha",
    )
    identity_duplicate = repo.find_duplicate_identity_import(
        snapshots_filename="snapshots.parquet",
        quotes_filename="quotes.parquet",
        snapshots_size=123,
        quotes_size=456,
    )

    assert record.status == "uploaded"
    assert record.session_id is None
    assert checksum_duplicate is not None
    assert checksum_duplicate.import_id == record.import_id
    assert identity_duplicate is not None
    assert identity_duplicate.import_id == record.import_id
    assert repo.find_duplicate_checksum_import(snapshots_sha256="other", quotes_sha256="quote-sha") is None


def test_status_transitions_enforce_happy_path_and_invalid_updates_do_not_write(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, _session_ids = import_repository
    record = _create_import(repo, import_ids)
    session_id = f"pytest-import-session-{uuid4()}"

    with pytest.raises(ValueError, match="expected validating -> awaiting_confirmation"):
        repo.mark_awaiting_confirmation(record.import_id, session_id=session_id)
    assert repo.get_import(record.import_id).status == "uploaded"
    assert repo.get_import(record.import_id).session_id is None

    repo.mark_validating(record.import_id)
    repo.save_validation(record.import_id, summary={"snapshot_count": 2}, warnings=["late quote"], errors=[])
    repo.mark_awaiting_confirmation(record.import_id, session_id=session_id)
    repo.mark_publishing(record.import_id)
    repo.mark_completed(record.import_id, session_id=session_id)

    completed = repo.get_import(record.import_id)
    assert completed.status == "completed"
    assert completed.session_id == session_id
    assert completed.validation_summary == {"snapshot_count": 2}
    assert completed.validation_warnings == ["late quote"]

    with pytest.raises(ValueError, match="cancel"):
        repo.mark_cancelled(record.import_id)
    assert repo.get_import(record.import_id).status == "completed"


def test_publish_import_rolls_back_all_session_rows_when_quote_insert_fails(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, session_ids = import_repository
    record = _create_import(repo, import_ids)
    session_id = f"pytest-import-session-{uuid4()}"
    session_ids.append(session_id)
    snapshots = _snapshots(session_id)
    duplicate_quotes = [_quote(session_id, "src-1", 0, "SPX-C-5200"), _quote(session_id, "src-1", 0, "SPX-C-5200")]
    repo.mark_validating(record.import_id)
    repo.mark_awaiting_confirmation(record.import_id, session_id=session_id)
    repo.mark_publishing(record.import_id)

    with pytest.raises(Exception):
        repo.publish_import(
            import_id=record.import_id,
            session_id=session_id,
            symbol="SPX",
            expiry="2026-04-24",
            start_time="2026-04-24T15:30:00Z",
            end_time="2026-04-24T15:40:00Z",
            snapshots=snapshots,
            quotes=duplicate_quotes,
        )

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM replay_sessions WHERE session_id = %s", (session_id,))
            session_count = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM replay_import_snapshots WHERE session_id = %s", (session_id,))
            snapshot_count = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM replay_import_quotes WHERE session_id = %s", (session_id,))
            quote_count = int(cursor.fetchone()[0])

    assert (session_count, snapshot_count, quote_count) == (0, 0, 0)
    assert repo.get_import(record.import_id).status == "publishing"


def test_publish_import_stores_normalized_source_records_and_query_methods(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, session_ids = import_repository
    record = _create_import(repo, import_ids)
    session_id = f"pytest-import-session-{uuid4()}"
    session_ids.append(session_id)
    snapshots = _snapshots(session_id)
    quotes = [
        _quote(session_id, "src-1", 0, "SPX-C-5200", mid=10.1),
        _quote(session_id, "src-1", 0, "SPX-P-5200", right="put", mid=9.9),
        _quote(session_id, "src-2", 1, "SPX-C-5210", mid=11.1),
    ]

    repo.mark_validating(record.import_id)
    repo.mark_awaiting_confirmation(record.import_id, session_id=session_id)
    repo.mark_publishing(record.import_id)
    repo.publish_import(
        import_id=record.import_id,
        session_id=session_id,
        symbol="SPX",
        expiry="2026-04-24",
        start_time="2026-04-24T15:30:00Z",
        end_time="2026-04-24T15:40:00Z",
        snapshots=snapshots,
        quotes=quotes,
    )

    completed = repo.get_import(record.import_id)
    completed_sessions = repo.list_completed_sessions()
    timestamps = repo.timestamps(session_id)
    first_snapshot = repo.snapshot_by_source_id(session_id, "src-1")
    nearest = repo.nearest_snapshot(session_id, "2026-04-24T15:34:00Z")
    streamed = repo.stream_snapshots(session_id, at="2026-04-24T15:35:00Z", source_snapshot_id=None)

    assert completed.status == "completed"
    assert completed.session_id == session_id
    session = next(item for item in completed_sessions if item["session_id"] == session_id)
    assert session["source"] == "parquet_import"
    assert session["timestamp_source"] == "exact"
    assert session["visibility"] == "public"
    assert session["snapshot_count"] == 2
    assert session["quote_count"] == 3
    assert session["import_id"] == record.import_id
    assert timestamps == [
        {"index": 0, "snapshot_time": "2026-04-24T15:30:00Z", "source_snapshot_id": "src-1"},
        {"index": 1, "snapshot_time": "2026-04-24T15:40:00Z", "source_snapshot_id": "src-2"},
    ]
    assert first_snapshot is not None
    assert first_snapshot.header.source_snapshot_id == "src-1"
    assert first_snapshot.header.snapshot_time == "2026-04-24T15:30:00Z"
    assert [quote.contract_id for quote in first_snapshot.quotes] == ["SPX-C-5200", "SPX-P-5200"]
    assert nearest is not None
    assert nearest.header.source_snapshot_id == "src-1"
    assert [snapshot.header.source_snapshot_id for snapshot in streamed] == ["src-2"]


def test_cleanup_created_records_does_not_require_analytics_snapshots_table(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, _session_ids = import_repository
    record = _create_import(repo, import_ids)
    session_id = f"pytest-cleanup-import-session-{uuid4()}"
    _publish_import(repo, record.import_id, session_id)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS analytics_snapshots")

    _cleanup_created_records(session_ids=[session_id], import_ids=[record.import_id])

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM replay_sessions WHERE session_id = %s", (session_id,))
            session_count = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM replay_imports WHERE import_id = %s", (record.import_id,))
            import_count = int(cursor.fetchone()[0])

    assert (session_count, import_count) == (0, 0)
    import_ids.remove(record.import_id)


def test_list_completed_sessions_excludes_unfinished_and_private_sessions(
    import_repository: tuple[PostgresReplayImportRepository, list[str], list[str]],
) -> None:
    repo, import_ids, session_ids = import_repository
    public_import = _create_import(repo, import_ids)
    private_import = _create_import(repo, import_ids)
    unfinished_import = _create_import(repo, import_ids)
    public_session_id = f"pytest-public-import-session-{uuid4()}"
    private_session_id = f"pytest-private-import-session-{uuid4()}"
    unfinished_session_id = f"pytest-unfinished-import-session-{uuid4()}"
    session_ids.extend([public_session_id, private_session_id, unfinished_session_id])

    _publish_import(repo, public_import.import_id, public_session_id)
    _publish_import(repo, private_import.import_id, private_session_id)
    repo.mark_validating(unfinished_import.import_id)
    repo.mark_awaiting_confirmation(unfinished_import.import_id, session_id=unfinished_session_id)
    repo.mark_publishing(unfinished_import.import_id)

    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE replay_sessions SET visibility = 'private' WHERE session_id = %s", (private_session_id,))

    session_ids = {session["session_id"] for session in repo.list_completed_sessions()}

    assert public_session_id in session_ids
    assert private_session_id not in session_ids
    assert unfinished_session_id not in session_ids


def _create_import(repo: PostgresReplayImportRepository, import_ids: list[str]):
    record = repo.create_import(
        snapshots_filename=f"snapshots-{uuid4()}.parquet",
        quotes_filename=f"quotes-{uuid4()}.parquet",
        snapshots_sha256=f"snap-sha-{uuid4()}",
        quotes_sha256=f"quote-sha-{uuid4()}",
        snapshots_size=123,
        quotes_size=456,
        snapshots_archive_path="/archive/import/snapshots.parquet",
        quotes_archive_path="/archive/import/quotes.parquet",
    )
    import_ids.append(record.import_id)
    return record


def _publish_import(repo: PostgresReplayImportRepository, import_id: str, session_id: str) -> None:
    repo.mark_validating(import_id)
    repo.mark_awaiting_confirmation(import_id, session_id=session_id)
    repo.mark_publishing(import_id)
    repo.publish_import(
        import_id=import_id,
        session_id=session_id,
        symbol="SPX",
        expiry="2026-04-24",
        start_time="2026-04-24T15:30:00Z",
        end_time="2026-04-24T15:40:00Z",
        snapshots=_snapshots(session_id),
        quotes=[_quote(session_id, "src-1", 0, f"{session_id}-SPX-C-5200")],
    )


def _cleanup_created_records(*, session_ids: list[str], import_ids: list[str]) -> None:
    with _connect() as connection:
        with connection.cursor() as cursor:
            for session_id in session_ids:
                cursor.execute("DELETE FROM replay_import_quotes WHERE session_id = %s", (session_id,))
                cursor.execute("DELETE FROM replay_import_snapshots WHERE session_id = %s", (session_id,))
                cursor.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            for import_id in import_ids:
                cursor.execute("DELETE FROM replay_imports WHERE import_id = %s", (import_id,))


def _snapshots(session_id: str) -> list[SnapshotRecord]:
    return [
        SnapshotRecord(
            session_id=session_id,
            source_snapshot_id="src-1",
            source_order=0,
            snapshot_time="2026-04-24T15:30:00Z",
            expiry="2026-04-24",
            spot=5200.25,
            pricing_spot=5200.5,
            forward=5201.25,
            risk_free_rate=0.04,
            t_minutes=390.0,
            selected_strike_count=4,
            valid_mid_contract_count=2,
            stale_contract_count=0,
            row_count=2,
        ),
        SnapshotRecord(
            session_id=session_id,
            source_snapshot_id="src-2",
            source_order=1,
            snapshot_time="2026-04-24T15:40:00Z",
            expiry="2026-04-24",
            spot=5210.25,
            pricing_spot=None,
            forward=5211.25,
            risk_free_rate=0.04,
            t_minutes=380.0,
            selected_strike_count=4,
            valid_mid_contract_count=1,
            stale_contract_count=1,
            row_count=None,
        ),
    ]


def _quote(
    session_id: str,
    source_snapshot_id: str,
    source_order: int,
    contract_id: str,
    *,
    right: str = "call",
    mid: float | None = 10.1,
) -> QuoteRecord:
    return QuoteRecord(
        session_id=session_id,
        source_snapshot_id=source_snapshot_id,
        source_order=source_order,
        contract_id=contract_id,
        strike=5200.0,
        right=right,
        bid=10.0,
        ask=10.2,
        mid=mid,
        ibkr_iv=0.21,
        open_interest=2400,
        quote_valid=mid is not None,
        ln_kf=0.001,
        distance_from_atm=0.0,
    )


def _connect():
    import psycopg

    return psycopg.connect(TEST_DATABASE_URL, connect_timeout=2)
