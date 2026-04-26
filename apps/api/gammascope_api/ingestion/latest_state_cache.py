from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol

from gammascope_api.ingestion.collector_state import CollectorState, collector_state

DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"
DEFAULT_REDIS_TIMEOUT_SECONDS = 0.25
LATEST_STATE_KEY = "gammascope:collector:latest_state"


class LatestStateCache(Protocol):
    def get(self) -> dict[str, Any] | None: ...

    def set(self, state: dict[str, Any]) -> None: ...

    def clear(self) -> None: ...


class InMemoryLatestStateCache:
    def __init__(self) -> None:
        self._state: dict[str, Any] | None = None

    def get(self) -> dict[str, Any] | None:
        if self._state is None:
            return None
        return deepcopy(self._state)

    def set(self, state: dict[str, Any]) -> None:
        self._state = deepcopy(state)

    def clear(self) -> None:
        self._state = None


class RedisLatestStateCache:
    def __init__(
        self,
        redis_url: str,
        *,
        key: str = LATEST_STATE_KEY,
        timeout_seconds: float | None = None,
    ) -> None:
        self.redis_url = redis_url
        self.key = key
        self.timeout_seconds = DEFAULT_REDIS_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds

    def get(self) -> dict[str, Any] | None:
        payload = self._client().get(self.key)
        if payload is None:
            return None
        return json.loads(payload)

    def set(self, state: dict[str, Any]) -> None:
        self._client().set(self.key, json.dumps(state))

    def clear(self) -> None:
        self._client().delete(self.key)

    @lru_cache(maxsize=1)
    def _client(self):
        from redis import Redis

        return Redis.from_url(
            self.redis_url,
            decode_responses=True,
            socket_connect_timeout=self.timeout_seconds,
            socket_timeout=self.timeout_seconds,
        )


_cache_override: LatestStateCache | None = None


def latest_state_cache() -> LatestStateCache:
    if _cache_override is not None:
        return _cache_override
    return _default_cache(redis_url(), redis_timeout_seconds())


def set_latest_state_cache_override(cache: LatestStateCache) -> None:
    global _cache_override
    _cache_override = cache


def reset_latest_state_cache_override() -> None:
    global _cache_override
    _cache_override = None
    _default_cache.cache_clear()


def redis_url() -> str:
    return os.environ.get("GAMMASCOPE_REDIS_URL", DEFAULT_REDIS_URL)


def redis_timeout_seconds() -> float:
    value = os.environ.get("GAMMASCOPE_REDIS_TIMEOUT_SECONDS")
    if value is None:
        return DEFAULT_REDIS_TIMEOUT_SECONDS
    try:
        parsed = float(value)
    except ValueError:
        return DEFAULT_REDIS_TIMEOUT_SECONDS
    return max(0.01, parsed)


def persist_latest_state(state: CollectorState) -> None:
    try:
        latest_state_cache().set(state.snapshot())
    except Exception:
        return


def cached_or_memory_collector_state() -> CollectorState:
    memory_state = collector_state.snapshot()
    try:
        cached_state = latest_state_cache().get()
    except Exception:
        cached_state = None
    if cached_state is not None and not _memory_state_is_fresher(memory_state, cached_state):
        return CollectorState.from_snapshot(cached_state)
    return collector_state


def _memory_state_is_fresher(memory_state: dict[str, Any], cached_state: dict[str, Any]) -> bool:
    memory_last_event_time = memory_state.get("last_event_time")
    cached_last_event_time = cached_state.get("last_event_time")
    if memory_last_event_time is None:
        return False
    if cached_last_event_time is None:
        return True
    memory_time = _parse_event_time(str(memory_last_event_time))
    cached_time = _parse_event_time(str(cached_last_event_time))
    if memory_time is not None and cached_time is not None:
        if memory_time != cached_time:
            return memory_time > cached_time
    elif str(memory_last_event_time) != str(cached_last_event_time):
        return str(memory_last_event_time) > str(cached_last_event_time)

    return _state_richness_score(memory_state) > _state_richness_score(cached_state)


def _parse_event_time(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _state_richness_score(state: dict[str, Any]) -> int:
    return sum(
        len(state.get(key, {}))
        for key in (
            "health_events",
            "contracts",
            "underlying_ticks",
            "option_ticks",
        )
    )


@lru_cache(maxsize=1)
def _default_cache(redis_url: str, timeout_seconds: float) -> LatestStateCache:
    return RedisLatestStateCache(redis_url, timeout_seconds=timeout_seconds)
