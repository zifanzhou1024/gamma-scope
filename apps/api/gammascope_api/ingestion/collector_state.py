from __future__ import annotations

from copy import deepcopy
from typing import Any

from gammascope_api.contracts.generated.collector_events import (
    CollectorEvents,
    CollectorHealth,
    ContractDiscovered,
    OptionTick,
    UnderlyingTick,
)


class CollectorState:
    def __init__(self) -> None:
        self.clear()

    def clear(self) -> None:
        self._health_events: dict[str, dict[str, Any]] = {}
        self._contracts: dict[str, dict[str, Any]] = {}
        self._underlying_ticks: dict[str, dict[str, Any]] = {}
        self._option_ticks: dict[str, dict[str, Any]] = {}
        self._last_event_time: str | None = None

    def ingest(self, event: CollectorEvents) -> str:
        payload = event.root
        event_type = type(payload).__name__
        event_dict = payload.model_dump(mode="json")
        self._last_event_time = event_dict.get("event_time")

        if isinstance(payload, CollectorHealth):
            self._health_events[payload.collector_id] = event_dict
        elif isinstance(payload, ContractDiscovered):
            self._contracts[payload.contract_id] = event_dict
        elif isinstance(payload, UnderlyingTick):
            self._underlying_ticks[payload.session_id] = event_dict
        elif isinstance(payload, OptionTick):
            self._option_ticks[payload.contract_id] = event_dict

        return event_type

    def summary(self) -> dict[str, Any]:
        return {
            "health_events_count": len(self._health_events),
            "contracts_count": len(self._contracts),
            "underlying_ticks_count": len(self._underlying_ticks),
            "option_ticks_count": len(self._option_ticks),
            "last_event_time": self._last_event_time,
            "latest_health": self.latest_health(),
        }

    def latest_health(self) -> dict[str, Any] | None:
        if not self._health_events:
            return None
        return max(self._health_events.values(), key=lambda event: str(event["received_time"]))

    def latest_underlying_tick(self, session_id: str | None = None) -> dict[str, Any] | None:
        underlying_ticks = self._underlying_ticks
        if session_id is not None:
            underlying_ticks = {
                stored_session_id: tick
                for stored_session_id, tick in underlying_ticks.items()
                if stored_session_id == session_id
            }
        if not underlying_ticks:
            return None
        return max(underlying_ticks.values(), key=lambda event: str(event["event_time"]))

    def contracts(self) -> list[dict[str, Any]]:
        return list(self._contracts.values())

    def option_ticks(self) -> dict[str, dict[str, Any]]:
        return dict(self._option_ticks)

    def last_event_time(self) -> str | None:
        return self._last_event_time

    def snapshot(self) -> dict[str, Any]:
        return {
            "health_events": deepcopy(self._health_events),
            "contracts": deepcopy(self._contracts),
            "underlying_ticks": deepcopy(self._underlying_ticks),
            "option_ticks": deepcopy(self._option_ticks),
            "last_event_time": self._last_event_time,
        }

    @classmethod
    def from_snapshot(cls, snapshot: dict[str, Any]) -> CollectorState:
        state = cls()
        state._health_events = deepcopy(snapshot.get("health_events", {}))
        state._contracts = deepcopy(snapshot.get("contracts", {}))
        state._underlying_ticks = deepcopy(snapshot.get("underlying_ticks", {}))
        state._option_ticks = deepcopy(snapshot.get("option_ticks", {}))
        state._last_event_time = snapshot.get("last_event_time")
        return state


collector_state = CollectorState()
