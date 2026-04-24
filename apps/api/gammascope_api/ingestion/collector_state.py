from __future__ import annotations

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


collector_state = CollectorState()
