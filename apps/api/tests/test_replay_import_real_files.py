from __future__ import annotations

from pathlib import Path

import pytest

from gammascope_api.replay.config import replay_baseline_paths
from gammascope_api.replay.dependencies import (
    get_replay_parquet_importer,
    reset_replay_import_repository_override,
    set_replay_import_repository_override,
)
from gammascope_api.replay.import_repository import PostgresReplayImportRepository


TEST_DATABASE_URL = "postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope"


def test_real_april_22_baseline_validates_when_present(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    snapshots, quotes = replay_baseline_paths()
    if not snapshots.exists() or not quotes.exists():
        pytest.skip("local replay baseline parquet files are absent")

    repo = PostgresReplayImportRepository(TEST_DATABASE_URL)
    try:
        repo.ensure_schema()
    except Exception as exc:
        pytest.skip(f"Postgres replay import persistence is unavailable: {exc}")

    import_ids: list[str] = []
    monkeypatch.setenv("GAMMASCOPE_REPLAY_ARCHIVE_DIR", str(tmp_path / "archive"))
    set_replay_import_repository_override(repo)
    try:
        importer = get_replay_parquet_importer()
        result = importer.create_import(snapshots_path=snapshots, quotes_path=quotes)
        import_ids.append(result.import_id)

        assert result.status == "awaiting_confirmation"
        assert result.summary["snapshot_count"] == 15787
        assert result.summary["quote_count"] == 1294534
    finally:
        reset_replay_import_repository_override()
        _delete_replay_imports(import_ids)


def _delete_replay_imports(import_ids: list[str]) -> None:
    if not import_ids:
        return

    import psycopg

    with psycopg.connect(TEST_DATABASE_URL, connect_timeout=2) as connection:
        with connection.cursor() as cursor:
            for import_id in import_ids:
                cursor.execute("DELETE FROM replay_imports WHERE import_id = %s", (import_id,))
