from __future__ import annotations

from functools import lru_cache

from gammascope_api.replay.dependencies import database_url
from gammascope_api.saved_views.repository import (
    InMemorySavedViewRepository,
    PostgresSavedViewRepository,
    SavedViewRepository,
)

_repository_override: SavedViewRepository | None = None
_fallback_repository = InMemorySavedViewRepository()
_repository_degraded = False


def get_saved_view_repository() -> SavedViewRepository:
    if _repository_degraded:
        return _fallback_repository
    if _repository_override is not None:
        return _repository_override
    return _default_saved_view_repository(database_url())


def get_saved_view_fallback_repository() -> SavedViewRepository:
    return _fallback_repository


def degrade_saved_view_repository_to_fallback() -> SavedViewRepository:
    global _repository_degraded
    _repository_degraded = True
    return _fallback_repository


def set_saved_view_repository_override(repository: SavedViewRepository) -> None:
    global _repository_override, _fallback_repository, _repository_degraded
    _repository_override = repository
    _fallback_repository = InMemorySavedViewRepository()
    _repository_degraded = False


def reset_saved_view_repository_override() -> None:
    global _repository_override, _fallback_repository, _repository_degraded
    _repository_override = None
    _fallback_repository = InMemorySavedViewRepository()
    _repository_degraded = False
    _default_saved_view_repository.cache_clear()


@lru_cache(maxsize=1)
def _default_saved_view_repository(database_url: str) -> SavedViewRepository:
    return PostgresSavedViewRepository(database_url)
