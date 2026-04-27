from json import JSONDecodeError
from typing import Any

from fastapi import APIRouter, Header, Request
from fastapi.exceptions import RequestValidationError
from pydantic import TypeAdapter, ValidationError

from gammascope_api.auth import require_private_mode_admin_token
from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state, persist_latest_state
from gammascope_api.replay.capture import capture_live_snapshot_from_state


router = APIRouter()
_collector_events_adapter = TypeAdapter(list[CollectorEvents])


@router.post("/api/spx/0dte/collector/events")
async def ingest_collector_event(
    request: Request,
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    require_private_mode_admin_token(x_gammascope_admin_token)
    payload = await _validated_collector_event(request)
    event_type = collector_state.ingest(payload)
    persist_latest_state(collector_state)
    replay_capture = capture_live_snapshot_from_state(collector_state)
    return {
        "accepted": True,
        "event_type": event_type,
        "state": collector_state.summary(),
        "replay_capture": replay_capture,
    }


@router.post("/api/spx/0dte/collector/events/bulk")
async def ingest_collector_events_bulk(
    request: Request,
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
    require_private_mode_admin_token(x_gammascope_admin_token)
    payloads = await _validated_collector_events(request)
    event_types = [collector_state.ingest(payload) for payload in payloads]
    persist_latest_state(collector_state)
    replay_capture = capture_live_snapshot_from_state(collector_state)
    return {
        "accepted": True,
        "accepted_count": len(event_types),
        "event_types": event_types,
        "state": collector_state.summary(),
        "replay_capture": replay_capture,
    }


@router.get("/api/spx/0dte/collector/state")
def get_collector_state(x_gammascope_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_private_mode_admin_token(x_gammascope_admin_token)
    return cached_or_memory_collector_state().summary()


async def _validated_collector_event(request: Request) -> CollectorEvents:
    try:
        raw_payload = await request.json()
        return CollectorEvents.model_validate(raw_payload)
    except JSONDecodeError as exc:
        raise RequestValidationError(
            [
                {
                    "type": "json_invalid",
                    "loc": ("body", exc.pos),
                    "msg": "JSON decode error",
                    "input": {},
                    "ctx": {"error": exc.msg},
                }
            ]
        ) from exc
    except ValidationError as exc:
        raise RequestValidationError(_body_validation_errors(exc), body=raw_payload) from exc


async def _validated_collector_events(request: Request) -> list[CollectorEvents]:
    try:
        raw_payload = await request.json()
        return _collector_events_adapter.validate_python(raw_payload)
    except JSONDecodeError as exc:
        raise RequestValidationError(
            [
                {
                    "type": "json_invalid",
                    "loc": ("body", exc.pos),
                    "msg": "JSON decode error",
                    "input": {},
                    "ctx": {"error": exc.msg},
                }
            ]
        ) from exc
    except ValidationError as exc:
        raise RequestValidationError(_body_validation_errors(exc), body=raw_payload) from exc


def _body_validation_errors(exc: ValidationError) -> list[dict[str, Any]]:
    errors = []
    for error in exc.errors():
        normalized_error = {key: value for key, value in error.items() if key != "url"}
        normalized_error["loc"] = ("body", *error["loc"])
        errors.append(normalized_error)
    return errors
