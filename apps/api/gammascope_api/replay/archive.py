from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import shutil


@dataclass(frozen=True)
class SourceFileInfo:
    filename: str
    size: int
    sha256: str


@dataclass(frozen=True)
class ReplayArchive:
    import_id: str
    snapshots_path: Path
    quotes_path: Path
    snapshots_size: int
    quotes_size: int
    snapshots_sha256: str
    quotes_sha256: str


def _validate_import_id(import_id: str) -> None:
    import_path = Path(import_id)
    if (
        not import_id
        or import_id in {".", ".."}
        or import_path.is_absolute()
        or import_path.name != import_id
        or "\\" in import_id
    ):
        raise ValueError("Replay import_id must be a safe single path segment")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def describe_source_file(path: Path) -> SourceFileInfo:
    source_path = Path(path)
    if not source_path.exists():
        raise FileNotFoundError(f"Source Parquet file not found: {source_path}")
    if not source_path.is_file():
        raise ValueError(f"Source Parquet path is not a file: {source_path}")
    return SourceFileInfo(
        filename=source_path.name,
        size=source_path.stat().st_size,
        sha256=sha256_file(source_path),
    )


def archive_replay_files(
    *,
    snapshots_path: Path,
    quotes_path: Path,
    archive_dir: Path,
    import_id: str,
) -> ReplayArchive:
    _validate_import_id(import_id)
    snapshots_source = describe_source_file(snapshots_path)
    quotes_source = describe_source_file(quotes_path)

    import_dir = Path(archive_dir) / import_id
    if import_dir.exists():
        raise FileExistsError(f"Replay archive already exists for import {import_id}: {import_dir}")
    import_dir.mkdir(parents=True)
    archived_snapshots_path = import_dir / "snapshots.parquet"
    archived_quotes_path = import_dir / "quotes.parquet"

    shutil.copy2(snapshots_path, archived_snapshots_path)
    shutil.copy2(quotes_path, archived_quotes_path)

    archived_snapshots = describe_source_file(archived_snapshots_path)
    archived_quotes = describe_source_file(archived_quotes_path)
    if archived_snapshots.sha256 != snapshots_source.sha256:
        raise IOError(f"Archived snapshot checksum mismatch for import {import_id}")
    if archived_quotes.sha256 != quotes_source.sha256:
        raise IOError(f"Archived quote checksum mismatch for import {import_id}")

    manifest = {
        "import_id": import_id,
        "snapshots": {
            "source_filename": snapshots_source.filename,
            "size": archived_snapshots.size,
            "sha256": archived_snapshots.sha256,
            "archive_path": str(archived_snapshots_path),
        },
        "quotes": {
            "source_filename": quotes_source.filename,
            "size": archived_quotes.size,
            "sha256": archived_quotes.sha256,
            "archive_path": str(archived_quotes_path),
        },
    }
    (import_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )

    return ReplayArchive(
        import_id=import_id,
        snapshots_path=archived_snapshots_path,
        quotes_path=archived_quotes_path,
        snapshots_size=archived_snapshots.size,
        quotes_size=archived_quotes.size,
        snapshots_sha256=archived_snapshots.sha256,
        quotes_sha256=archived_quotes.sha256,
    )
