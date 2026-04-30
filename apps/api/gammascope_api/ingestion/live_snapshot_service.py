from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Literal

from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import _freshness_ms, build_live_snapshot, build_spx_dashboard_live_snapshot

HeatmapSymbol = Literal["SPX", "SPY", "QQQ", "NDX", "IWM"]

MOOMOO_LIVE_REPLAY_SESSION_IDS: dict[HeatmapSymbol, str] = {
    "SPX": "moomoo-spx-0dte-live",
    "SPY": "moomoo-spy-0dte-live",
    "QQQ": "moomoo-qqq-0dte-live",
    "NDX": "moomoo-ndx-0dte-live",
    "IWM": "moomoo-iwm-0dte-live",
}

_DASHBOARD_KEY = "__dashboard__"
StateIdentity = tuple[str | None, int, str | None, int, int, int, int]


@dataclass(frozen=True)
class _CachedSnapshot:
    state_identity: StateIdentity
    snapshot: dict[str, Any] | None


class LiveSnapshotService:
    def __init__(self, state_provider: Callable[[], CollectorState] = cached_or_memory_collector_state) -> None:
        self._state_provider = state_provider
        self._cache: dict[str, _CachedSnapshot] = {}

    def dashboard_snapshot(self) -> dict[str, Any] | None:
        return self._cached_snapshot(
            _DASHBOARD_KEY,
            lambda state: build_spx_dashboard_live_snapshot(state),
        )

    def session_snapshot(self, session_id: str) -> dict[str, Any] | None:
        return self._cached_snapshot(
            session_id,
            lambda state: build_live_snapshot(state, session_id=session_id),
        )

    def symbol_snapshot(self, symbol: HeatmapSymbol) -> dict[str, Any] | None:
        return self.session_snapshot(MOOMOO_LIVE_REPLAY_SESSION_IDS[symbol])

    def _cached_snapshot(
        self,
        cache_key: str,
        builder: Callable[[CollectorState], dict[str, Any] | None],
    ) -> dict[str, Any] | None:
        state = self._state_provider()
        state_identity = _state_identity(state)
        cached = self._cache.get(cache_key)

        if cached is None or cached.state_identity != state_identity:
            cached = _CachedSnapshot(state_identity=state_identity, snapshot=builder(state))
            self._cache[cache_key] = cached

        return _snapshot_response(cached.snapshot)


_service_override: LiveSnapshotService | None = None


def get_live_snapshot_service() -> LiveSnapshotService:
    if _service_override is not None:
        return _service_override
    return _default_live_snapshot_service()


def set_live_snapshot_service_override(service: LiveSnapshotService) -> None:
    global _service_override
    _service_override = service


def reset_live_snapshot_service_override() -> None:
    global _service_override
    _service_override = None
    _default_live_snapshot_service.cache_clear()


@lru_cache(maxsize=1)
def _default_live_snapshot_service() -> LiveSnapshotService:
    return LiveSnapshotService()


def _state_identity(state: CollectorState) -> StateIdentity:
    summary = state.summary()
    return (
        _string_or_none(summary.get("state_epoch")),
        _int_value(summary.get("revision")),
        _string_or_none(summary.get("last_event_time")),
        _int_value(summary.get("health_events_count")),
        _int_value(summary.get("contracts_count")),
        _int_value(summary.get("underlying_ticks_count")),
        _int_value(summary.get("option_ticks_count")),
    )


def _snapshot_response(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    if snapshot is None:
        return None

    response = deepcopy(snapshot)
    snapshot_time = response.get("snapshot_time")
    if isinstance(snapshot_time, str):
        try:
            response["freshness_ms"] = _freshness_ms(snapshot_time)
        except ValueError:
            pass
    return response


def _int_value(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _string_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)
