import json
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import pytest

from gammascope_api.replay.archive import archive_replay_files, describe_source_file, sha256_file
from gammascope_api.replay.config import replay_archive_dir, replay_import_max_bytes
from gammascope_api.replay.parquet_reader import iter_replay_quote_records, read_replay_parquet_pair

from replay_parquet_fixtures import tiny_quote_rows, tiny_snapshot_rows, write_replay_parquet_pair


def test_pyarrow_and_multipart_dependencies_are_declared() -> None:
    pyproject = tomllib.loads(Path("apps/api/pyproject.toml").read_text())

    assert "pyarrow>=16" in pyproject["project"]["dependencies"]
    assert "python-multipart>=0.0.22" in pyproject["project"]["dependencies"]


def test_default_replay_archive_dir_is_ignored_local_path(monkeypatch) -> None:
    monkeypatch.delenv("GAMMASCOPE_REPLAY_ARCHIVE_DIR", raising=False)

    assert replay_archive_dir() == Path(".gammascope/replay-archive")


def test_default_import_max_bytes_is_100_mb(monkeypatch) -> None:
    monkeypatch.delenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", raising=False)

    assert replay_import_max_bytes() == 100 * 1024 * 1024


def test_sha256_file_returns_stable_hash(tmp_path: Path) -> None:
    source_path = tmp_path / "source.parquet"
    source_path.write_bytes(b"stable parquet bytes")

    assert sha256_file(source_path) == sha256_file(source_path)
    assert sha256_file(source_path) == "c1cf4ba56a3c698d08df42b7d59dd1814cccb7a6657003b34bb8b1103b737d52"


def test_describe_source_file_returns_name_size_and_sha256(tmp_path: Path) -> None:
    source_path = tmp_path / "snapshots-upload.parquet"
    source_path.write_bytes(b"snapshot bytes")

    source_info = describe_source_file(source_path)

    assert source_info.filename == "snapshots-upload.parquet"
    assert source_info.size == len(b"snapshot bytes")
    assert source_info.sha256 == sha256_file(source_path)


def test_archive_replay_files_copies_inputs_and_writes_manifest(tmp_path: Path) -> None:
    snapshots_path = tmp_path / "snapshots-upload.parquet"
    quotes_path = tmp_path / "quotes-upload.parquet"
    snapshots_path.write_bytes(b"snapshot bytes")
    quotes_path.write_bytes(b"quote bytes")
    archive_dir = tmp_path / "archive"

    archive = archive_replay_files(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        archive_dir=archive_dir,
        import_id="import-123",
    )

    archived_snapshots = archive_dir / "import-123" / "snapshots.parquet"
    archived_quotes = archive_dir / "import-123" / "quotes.parquet"
    assert archive.import_id == "import-123"
    assert archive.snapshots_path == archived_snapshots
    assert archive.quotes_path == archived_quotes
    assert archived_snapshots.read_bytes() == b"snapshot bytes"
    assert archived_quotes.read_bytes() == b"quote bytes"
    assert snapshots_path.read_bytes() == b"snapshot bytes"
    assert quotes_path.read_bytes() == b"quote bytes"
    assert archive.snapshots_size == len(b"snapshot bytes")
    assert archive.quotes_size == len(b"quote bytes")
    assert archive.snapshots_sha256 == sha256_file(snapshots_path)
    assert archive.quotes_sha256 == sha256_file(quotes_path)

    manifest = json.loads((archive_dir / "import-123" / "manifest.json").read_text())
    assert manifest == {
        "import_id": "import-123",
        "snapshots": {
            "source_filename": "snapshots-upload.parquet",
            "size": len(b"snapshot bytes"),
            "sha256": sha256_file(snapshots_path),
            "archive_path": str(archived_snapshots),
        },
        "quotes": {
            "source_filename": "quotes-upload.parquet",
            "size": len(b"quote bytes"),
            "sha256": sha256_file(quotes_path),
            "archive_path": str(archived_quotes),
        },
    }


@pytest.mark.parametrize("import_id", ["../escaped", "/absolute/import", "nested/import", ""])
def test_archive_replay_files_rejects_unsafe_import_id(tmp_path: Path, import_id: str) -> None:
    snapshots_path = tmp_path / "snapshots-upload.parquet"
    quotes_path = tmp_path / "quotes-upload.parquet"
    snapshots_path.write_bytes(b"snapshot bytes")
    quotes_path.write_bytes(b"quote bytes")
    archive_dir = tmp_path / "archive"

    with pytest.raises(ValueError, match="safe single path segment"):
        archive_replay_files(
            snapshots_path=snapshots_path,
            quotes_path=quotes_path,
            archive_dir=archive_dir,
            import_id=import_id,
        )


def test_archive_replay_files_rejects_existing_import_archive(tmp_path: Path) -> None:
    snapshots_path = tmp_path / "snapshots-upload.parquet"
    quotes_path = tmp_path / "quotes-upload.parquet"
    snapshots_path.write_bytes(b"snapshot bytes")
    quotes_path.write_bytes(b"quote bytes")
    archive_dir = tmp_path / "archive"
    archive_replay_files(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        archive_dir=archive_dir,
        import_id="import-123",
    )

    snapshots_path.write_bytes(b"replacement snapshot bytes")
    quotes_path.write_bytes(b"replacement quote bytes")
    with pytest.raises(FileExistsError, match="Replay archive already exists"):
        archive_replay_files(
            snapshots_path=snapshots_path,
            quotes_path=quotes_path,
            archive_dir=archive_dir,
            import_id="import-123",
        )

    assert (archive_dir / "import-123" / "snapshots.parquet").read_bytes() == b"snapshot bytes"
    assert (archive_dir / "import-123" / "quotes.parquet").read_bytes() == b"quote bytes"


def test_reads_tiny_replay_parquet_pair_and_normalizes_records(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
        load_quotes=True,
    )

    assert result.errors == []
    assert result.warnings == ["1 invalid quote rows found"]
    assert len(result.snapshots) == 3
    assert len(result.quotes) == 12
    assert result.summary["snapshot_count"] == 3
    assert result.summary["quote_count"] == 12
    assert result.summary["valid_quote_count"] == 11
    assert result.summary["invalid_quote_count"] == 1
    assert result.summary["quote_rows_per_snapshot"] == 4
    assert result.summary["source_row_count_profile"] == [999, 999, 999]
    assert result.summary["snapshot_previews"] == [
        {
            "source_snapshot_id": "snap-1",
            "source_order": 0,
            "snapshot_time": "2026-04-24T14:30:00Z",
            "row_count": 999,
        },
        {
            "source_snapshot_id": "snap-2",
            "source_order": 1,
            "snapshot_time": "2026-04-24T14:31:00Z",
            "row_count": 999,
        },
        {
            "source_snapshot_id": "snap-3",
            "source_order": 2,
            "snapshot_time": "2026-04-24T14:32:00Z",
            "row_count": 999,
        },
    ]

    first_snapshot = result.snapshots[0]
    assert first_snapshot.session_id == "session-1"
    assert first_snapshot.source_snapshot_id == "snap-1"
    assert first_snapshot.source_order == 0
    assert first_snapshot.snapshot_time == "2026-04-24T14:30:00Z"
    assert first_snapshot.expiry == "2026-04-24"
    assert first_snapshot.spot == 5100.25
    assert first_snapshot.pricing_spot == 5100.25
    assert first_snapshot.forward == 5101.0
    assert first_snapshot.row_count == 999
    assert result.snapshot_id_map["snap-1"] == first_snapshot

    first_quote = result.quotes[0]
    assert first_quote.session_id == "session-1"
    assert first_quote.source_snapshot_id == "snap-1"
    assert first_quote.source_order == 0
    assert first_quote.contract_id == "SPXW-2026-04-24-C-5095"
    assert first_quote.right == "call"
    assert first_quote.ibkr_iv == 0.18
    assert first_quote.open_interest == 123
    assert first_quote.quote_valid is True


def test_pricing_spot_falls_back_to_spot_when_not_positive_or_finite(tmp_path: Path) -> None:
    def mutate_snapshots(rows):
        rows[0]["pricing_spot"] = 0.0
        rows[1]["pricing_spot"] = None

    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, mutate_snapshots=mutate_snapshots)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.errors == []
    assert result.snapshots[0].spot == 5100.0
    assert result.snapshots[0].pricing_spot is None
    assert result.snapshots[1].spot == 5101.0
    assert result.snapshots[1].pricing_spot is None


def test_default_read_validates_without_materializing_quote_records(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.errors == []
    assert result.summary["quote_count"] == 12
    assert result.quotes == []


def test_schema_validation_reports_missing_required_columns(tmp_path: Path) -> None:
    snapshots = tiny_snapshot_rows()
    quotes = tiny_quote_rows(snapshots)
    for row in snapshots:
        row.pop("forward_price")
        row["trade_date"] = "2026-04-24"
    for row in quotes:
        row.pop("iv")
        row["trade_date"] = "2026-04-24"
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, snapshots=snapshots, quotes=quotes)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.snapshots == []
    assert result.quotes == []
    assert "snapshots.parquet missing required columns: forward_price" in result.errors
    assert "quotes.parquet missing required columns: iv" in result.errors
    assert not any("trade_date" in error for error in result.errors)


def test_schema_validation_reports_invalid_row_values(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(
        tmp_path,
        mutate_quotes=lambda rows: rows[0].update({"option_type": "X"}),
    )

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert any("quotes.parquet row 0 invalid option_type" in error for error in result.errors)


def test_quote_validation_error_messages_are_capped_by_error_class(tmp_path: Path) -> None:
    snapshots = tiny_snapshot_rows()
    quotes = tiny_quote_rows(snapshots)
    for row in quotes:
        row["option_type"] = "X"
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, snapshots=snapshots, quotes=quotes)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    option_type_errors = [error for error in result.errors if "invalid option_type" in error]
    assert option_type_errors == [
        "quotes.parquet invalid option_type in 12 rows; example rows: 0, 1, 2, 3, 4"
    ]


def test_duplicate_market_times_are_preserved_with_warning(tmp_path: Path) -> None:
    def mutate_snapshots(rows):
        rows[1]["market_time"] = rows[0]["market_time"]

    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, mutate_snapshots=mutate_snapshots)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.errors == []
    assert any("duplicate market_time values" in warning for warning in result.warnings)
    assert [snapshot.source_order for snapshot in result.snapshots] == [0, 1, 2]
    assert result.snapshots[0].snapshot_time == result.snapshots[1].snapshot_time


def test_duplicate_snapshot_ids_fail(tmp_path: Path) -> None:
    def mutate_snapshots(rows):
        rows[1]["snapshot_id"] = rows[0]["snapshot_id"]

    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, mutate_snapshots=mutate_snapshots)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.snapshots == []
    assert any("duplicate snapshot_id values in snapshots.parquet: snap-1" in error for error in result.errors)


def test_quote_snapshot_id_without_matching_snapshot_fails(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(
        tmp_path,
        mutate_quotes=lambda rows: rows[0].update({"snapshot_id": "missing-snapshot"}),
    )

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.quotes == []
    assert any(
        "quote snapshot_id values without snapshot rows: missing-snapshot" in error
        for error in result.errors
    )


def test_expiry_mismatch_fails(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(
        tmp_path,
        mutate_quotes=lambda rows: rows[0].update({"expiry": datetime(2026, 4, 25, 20, 0, tzinfo=timezone.utc)}),
    )

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert any("expiry mismatch between snapshots.parquet and quotes.parquet" in error for error in result.errors)


def test_source_row_count_is_not_used_as_quote_row_count(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.summary["source_row_count_profile"] == [999, 999, 999]
    assert result.summary["quote_count"] == 12
    assert result.summary["quote_rows_per_snapshot"] == 4


def test_absent_source_row_count_stays_null_in_diagnostics(tmp_path: Path) -> None:
    snapshots = tiny_snapshot_rows()
    for row in snapshots:
        row.pop("row_count")
    quotes = tiny_quote_rows(snapshots)
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, snapshots=snapshots, quotes=quotes)

    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
    )

    assert result.errors == []
    assert result.summary["source_row_count_profile"] == [None, None, None]
    assert result.summary["quote_rows_per_snapshot"] == 4


def test_fixture_helper_preserves_explicit_empty_rows(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path, snapshots=[], quotes=[])

    import pyarrow.parquet as pq

    assert pq.read_table(snapshots_path).num_rows == 0
    assert pq.read_table(quotes_path).num_rows == 0


def test_streams_quote_records_from_parquet_batches(tmp_path: Path) -> None:
    snapshots_path, quotes_path = write_replay_parquet_pair(tmp_path)
    result = read_replay_parquet_pair(
        snapshots_path=snapshots_path,
        quotes_path=quotes_path,
        session_id="session-1",
        load_quotes=False,
    )

    quotes = list(
        iter_replay_quote_records(
            quotes_path=quotes_path,
            snapshot_id_map=result.snapshot_id_map,
            session_id="session-1",
            expiry="2026-04-24",
        )
    )

    assert result.quotes == []
    assert len(quotes) == 12
    assert quotes[-1].quote_valid is False
