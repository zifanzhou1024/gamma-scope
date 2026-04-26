from pathlib import Path
import os

DEFAULT_REPLAY_ARCHIVE_DIR = Path(".gammascope/replay-archive")
DEFAULT_BASELINE_DIR = Path(".gammascope/replay-baselines/2026-04-22")
DEFAULT_IMPORT_MAX_BYTES = 100 * 1024 * 1024


def replay_archive_dir() -> Path:
    return Path(
        os.environ.get("GAMMASCOPE_REPLAY_ARCHIVE_DIR", str(DEFAULT_REPLAY_ARCHIVE_DIR))
    )


def replay_import_max_bytes() -> int:
    value = os.environ.get("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES")
    if value is None:
        return DEFAULT_IMPORT_MAX_BYTES
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_IMPORT_MAX_BYTES
    return max(1, parsed)


def replay_baseline_paths(
    base_dir: Path = DEFAULT_BASELINE_DIR,
) -> tuple[Path, Path]:
    return base_dir / "snapshots.parquet", base_dir / "quotes.parquet"
