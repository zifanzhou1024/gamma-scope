from __future__ import annotations

from functools import lru_cache

from gammascope_api.heatmap.repository import HeatmapRepository, PostgresHeatmapRepository
from gammascope_api.replay.dependencies import database_url


_repository_override: HeatmapRepository | None = None


def get_heatmap_repository() -> HeatmapRepository:
    if _repository_override is not None:
        return _repository_override
    return _default_heatmap_repository(database_url())


def set_heatmap_repository_override(repository: HeatmapRepository) -> None:
    global _repository_override
    _repository_override = repository


def reset_heatmap_repository_override() -> None:
    global _repository_override
    _repository_override = None
    _default_heatmap_repository.cache_clear()


@lru_cache(maxsize=1)
def _default_heatmap_repository(database_url: str) -> HeatmapRepository:
    return PostgresHeatmapRepository(database_url)
