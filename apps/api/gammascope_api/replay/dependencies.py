from __future__ import annotations

import os
from functools import lru_cache

from gammascope_api.replay.import_repository import PostgresReplayImportRepository, ReplayImportRepository
from gammascope_api.replay.repository import PostgresReplayRepository, ReplayRepository

DEFAULT_DATABASE_URL = "postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope"
DEFAULT_CAPTURE_INTERVAL_SECONDS = 5

_repository_override: ReplayRepository | None = None
_import_repository_override: ReplayImportRepository | None = None


def get_replay_repository() -> ReplayRepository:
    if _repository_override is not None:
        return _repository_override
    return _default_replay_repository(database_url())


def set_replay_repository_override(repository: ReplayRepository) -> None:
    global _repository_override
    _repository_override = repository


def reset_replay_repository_override() -> None:
    global _repository_override
    _repository_override = None
    _default_replay_repository.cache_clear()


def get_replay_import_repository() -> ReplayImportRepository:
    if _import_repository_override is not None:
        return _import_repository_override
    return _default_replay_import_repository(database_url())


def set_replay_import_repository_override(repository: ReplayImportRepository) -> None:
    global _import_repository_override
    _import_repository_override = repository


def reset_replay_import_repository_override() -> None:
    global _import_repository_override
    _import_repository_override = None
    _default_replay_import_repository.cache_clear()


def database_url() -> str:
    return os.environ.get("GAMMASCOPE_DATABASE_URL", DEFAULT_DATABASE_URL)


def capture_interval_seconds() -> int:
    value = os.environ.get("GAMMASCOPE_REPLAY_CAPTURE_INTERVAL_SECONDS")
    if value is None:
        return DEFAULT_CAPTURE_INTERVAL_SECONDS
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_CAPTURE_INTERVAL_SECONDS
    return max(1, parsed)


@lru_cache(maxsize=1)
def _default_replay_repository(database_url: str) -> ReplayRepository:
    return PostgresReplayRepository(database_url)


@lru_cache(maxsize=1)
def _default_replay_import_repository(database_url: str) -> ReplayImportRepository:
    return PostgresReplayImportRepository(database_url)
