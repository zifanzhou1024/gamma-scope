import tomllib
from pathlib import Path

from gammascope_api.replay.config import replay_archive_dir, replay_import_max_bytes


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
