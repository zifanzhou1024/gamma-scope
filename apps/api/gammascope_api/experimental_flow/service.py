from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.estimator import estimate_flow


Mode = Literal["latest", "replay"]

_latest_snapshots: dict[str, dict[str, Any]] = {}

_ESTIMATED_FLOW_DIAGNOSTIC = {
    "code": "estimated_flow_only",
    "message": "Flow is inferred from free quote snapshots and is not official customer or market-maker open/close flow.",
    "severity": "info",
}


def reset_experimental_flow_memory() -> None:
    _latest_snapshots.clear()


def build_latest_experimental_flow_payload(current_snapshot: dict[str, Any]) -> dict[str, Any]:
    session_id = _text(current_snapshot.get("session_id")) or "unknown-session"
    current_time = _text(current_snapshot.get("snapshot_time"))
    previous_snapshot = _latest_snapshots.get(session_id)

    if previous_snapshot is None:
        _latest_snapshots[session_id] = current_snapshot
        return _empty_payload(current_snapshot, mode="latest", previous_snapshot=None)

    previous_time = _text(previous_snapshot.get("snapshot_time"))
    if current_time is None or previous_time is None or _parse_time(current_time) <= _parse_time(previous_time):
        return _empty_payload(current_snapshot, mode="latest", previous_snapshot=None)

    payload = build_experimental_flow_payload(current_snapshot, previous_snapshot, mode="latest")
    _latest_snapshots[session_id] = current_snapshot
    return payload


def build_experimental_flow_payload(
    current_snapshot: dict[str, Any],
    previous_snapshot: dict[str, Any],
    *,
    mode: Mode,
    replay_validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    estimated = estimate_flow(current_snapshot, previous_snapshot)
    payload = {
        "schema_version": "1.0.0",
        "meta": _meta(current_snapshot, previous_snapshot=previous_snapshot, mode=mode),
        "summary": estimated["summary"],
        "strikeRows": estimated["strikeRows"],
        "contractRows": estimated["contractRows"],
        "replayValidation": replay_validation,
        "diagnostics": [_ESTIMATED_FLOW_DIAGNOSTIC],
    }
    return validate_experimental_flow_payload(payload)


def validate_experimental_flow_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return ExperimentalFlow.model_validate(payload).model_dump(mode="json")


def _empty_payload(
    current_snapshot: dict[str, Any],
    *,
    mode: Mode,
    previous_snapshot: dict[str, Any] | None,
    replay_validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "schema_version": "1.0.0",
        "meta": _meta(current_snapshot, previous_snapshot=previous_snapshot, mode=mode),
        "summary": {
            "estimatedBuyContracts": 0,
            "estimatedSellContracts": 0,
            "netEstimatedContracts": 0,
            "netPremiumFlow": 0,
            "netDeltaFlow": None,
            "netGammaFlow": None,
            "estimatedDealerGammaPressure": None,
            "confidence": "unknown",
        },
        "strikeRows": [],
        "contractRows": [],
        "replayValidation": replay_validation,
        "diagnostics": [
            _ESTIMATED_FLOW_DIAGNOSTIC,
            {
                "code": "missing_previous_snapshot",
                "message": "A prior snapshot is required before estimated flow can be inferred from volume deltas.",
                "severity": "warning",
            },
        ],
    }
    return validate_experimental_flow_payload(payload)


def _meta(current_snapshot: dict[str, Any], *, previous_snapshot: dict[str, Any] | None, mode: Mode) -> dict[str, Any]:
    return {
        "mode": mode,
        "symbol": "SPX",
        "expiry": _text(current_snapshot.get("expiry")) or "1970-01-01",
        "generatedAt": _now(),
        "sourceSessionId": _text(current_snapshot.get("session_id")) or "unknown-session",
        "currentSnapshotTime": _text(current_snapshot.get("snapshot_time")) or _now(),
        "previousSnapshotTime": _text(previous_snapshot.get("snapshot_time")) if previous_snapshot is not None else None,
    }


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
