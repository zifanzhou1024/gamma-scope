from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from gammascope_api.contracts.generated.experimental_flow import ExperimentalFlow
from gammascope_api.experimental_flow.estimator import estimate_flow


Mode = Literal["latest", "replay"]

_latest_snapshots: dict[str, dict[str, Any]] = {}
_latest_payloads: dict[str, dict[str, Any]] = {}

_ESTIMATED_FLOW_DIAGNOSTIC = {
    "code": "estimated_flow_only",
    "message": "Flow is inferred from free quote snapshots and is not official customer or market-maker open/close flow.",
    "severity": "info",
}


def reset_experimental_flow_memory() -> None:
    _latest_snapshots.clear()
    _latest_payloads.clear()


def has_latest_payload_for_session(session_id: str) -> bool:
    return session_id in _latest_payloads


def build_latest_experimental_flow_payload(
    current_snapshot: dict[str, Any],
    *,
    previous_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session_id = _text(current_snapshot.get("session_id")) or "unknown-session"
    current_time = _text(current_snapshot.get("snapshot_time"))
    stored_snapshot = _latest_snapshots.get(session_id)
    previous_snapshot = _newest_snapshot_before(current_time, stored_snapshot, previous_snapshot)

    if not _snapshot_has_rows(current_snapshot):
        return _cached_latest_payload_or_empty(session_id, current_snapshot)

    if previous_snapshot is None:
        if _current_not_newer_than_stored(current_time, stored_snapshot):
            return _cached_latest_payload_or_empty(session_id, current_snapshot)
        _latest_snapshots[session_id] = current_snapshot
        return _empty_payload(current_snapshot, mode="latest", previous_snapshot=None)

    previous_time = _text(previous_snapshot.get("snapshot_time"))
    if current_time is None or previous_time is None or _parse_time(current_time) <= _parse_time(previous_time):
        return _cached_latest_payload_or_empty(session_id, current_snapshot)

    payload = build_experimental_flow_payload(current_snapshot, previous_snapshot, mode="latest")
    _latest_snapshots[session_id] = current_snapshot
    if _payload_has_rows(payload):
        _latest_payloads[session_id] = payload
        return payload
    return _cached_latest_payload_or_empty(session_id, current_snapshot, fallback=payload)


def build_replay_experimental_flow_payload(
    snapshots: list[dict[str, Any]],
    *,
    horizon_minutes: int = 5,
) -> dict[str, Any]:
    horizon = _replay_horizon(horizon_minutes)
    ordered = sorted(snapshots, key=_safe_snapshot_sort_key)
    valid_ordered = [snapshot for snapshot in ordered if _has_valid_snapshot_time(snapshot)]
    replay_validation = _replay_validation(valid_ordered, horizon_minutes=horizon)

    if len(valid_ordered) < 2:
        current = valid_ordered[-1] if valid_ordered else _replay_fallback_snapshot()
        return _empty_payload(current, mode="replay", previous_snapshot=None, replay_validation=replay_validation)

    return build_experimental_flow_payload(
        valid_ordered[1],
        valid_ordered[0],
        mode="replay",
        replay_validation=replay_validation,
    )


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


def _cached_latest_payload_or_empty(
    session_id: str,
    current_snapshot: dict[str, Any],
    *,
    fallback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cached_payload = _latest_payloads.get(session_id)
    if cached_payload is not None:
        return deepcopy(cached_payload)
    if fallback is not None:
        return fallback
    return _empty_payload(current_snapshot, mode="latest", previous_snapshot=None)


def _payload_has_rows(payload: dict[str, Any]) -> bool:
    contract_rows = payload.get("contractRows")
    strike_rows = payload.get("strikeRows")
    return (isinstance(contract_rows, list) and len(contract_rows) > 0) or (
        isinstance(strike_rows, list) and len(strike_rows) > 0
    )


def _snapshot_has_rows(snapshot: dict[str, Any]) -> bool:
    rows = snapshot.get("rows")
    return isinstance(rows, list) and len(rows) > 0


def _newest_snapshot_before(current_time: str | None, *snapshots: dict[str, Any] | None) -> dict[str, Any] | None:
    current = _safe_parse_time(current_time) if current_time is not None else None
    if current is None:
        return None

    candidates = []
    for snapshot in snapshots:
        if snapshot is None or not _snapshot_has_rows(snapshot):
            continue
        snapshot_time = _text(snapshot.get("snapshot_time"))
        parsed_snapshot_time = _safe_parse_time(snapshot_time) if snapshot_time is not None else None
        if parsed_snapshot_time is not None and parsed_snapshot_time < current:
            candidates.append((parsed_snapshot_time, snapshot))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def _current_not_newer_than_stored(current_time: str | None, stored_snapshot: dict[str, Any] | None) -> bool:
    if stored_snapshot is None or current_time is None:
        return False
    stored_time = _text(stored_snapshot.get("snapshot_time"))
    parsed_current_time = _safe_parse_time(current_time)
    parsed_stored_time = _safe_parse_time(stored_time) if stored_time is not None else None
    if parsed_current_time is None or parsed_stored_time is None:
        return False
    return parsed_current_time <= parsed_stored_time


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


def _replay_validation(snapshots: list[dict[str, Any]], *, horizon_minutes: int) -> dict[str, Any]:
    rows = []
    for index in range(1, len(snapshots)):
        current = snapshots[index]
        previous = snapshots[index - 1]
        current_time = _text(current.get("snapshot_time"))
        parsed_current_time = _safe_parse_time(current_time) if current_time is not None else None
        current_spot = _number(current.get("spot"))
        if current_time is None or parsed_current_time is None or current_spot is None or current_spot <= 0:
            continue

        estimated = estimate_flow(current, previous)
        pressure = _number(estimated["summary"].get("estimatedDealerGammaPressure"))
        future = _future_snapshot(snapshots[index + 1 :], current_time, horizon_minutes=horizon_minutes)
        future_spot = _number(future.get("spot")) if future is not None else None
        realized_move = future_spot - current_spot if future_spot is not None else None

        rows.append(
            {
                "snapshotTime": current_time,
                "pressureDirection": _direction(pressure),
                "pressureMagnitude": abs(pressure) if pressure is not None else None,
                "currentSpot": current_spot,
                "futureSpot": future_spot,
                "realizedMove": realized_move,
                "classification": _classification(pressure, realized_move),
            }
        )

    scored_rows = [row for row in rows if row["classification"] in {"hit", "miss"}]
    hit_rate = None if not scored_rows else sum(1 for row in scored_rows if row["classification"] == "hit") / len(scored_rows)
    return {
        "horizonMinutes": horizon_minutes,
        "rows": rows,
        "hitRate": hit_rate,
    }


def _future_snapshot(
    snapshots: list[dict[str, Any]],
    snapshot_time: str,
    *,
    horizon_minutes: int,
) -> dict[str, Any] | None:
    parsed_snapshot_time = _safe_parse_time(snapshot_time)
    if parsed_snapshot_time is None:
        return None
    target_time = parsed_snapshot_time + timedelta(minutes=horizon_minutes)
    for snapshot in snapshots:
        future_time = _text(snapshot.get("snapshot_time"))
        parsed_future_time = _safe_parse_time(future_time) if future_time is not None else None
        if parsed_future_time is not None and parsed_future_time >= target_time:
            return snapshot
    return None


def _direction(value: float | None) -> str:
    if value is None:
        return "unknown"
    if value > 0:
        return "positive"
    if value < 0:
        return "negative"
    return "flat"


def _classification(pressure: float | None, realized_move: float | None) -> str:
    if pressure is None or realized_move is None:
        return "unknown"
    if pressure == 0 or realized_move == 0:
        return "flat"
    if (pressure > 0 and realized_move > 0) or (pressure < 0 and realized_move < 0):
        return "hit"
    return "miss"


def _replay_horizon(value: int) -> int:
    return value if value in {5, 15, 30} else 5


def _safe_snapshot_sort_key(snapshot: dict[str, Any]) -> tuple[int, datetime, str]:
    snapshot_time = _text(snapshot.get("snapshot_time"))
    parsed_time = _safe_parse_time(snapshot_time) if snapshot_time is not None else None
    if parsed_time is None:
        return (1, datetime.max.replace(tzinfo=UTC), snapshot_time or "")
    return (0, parsed_time, snapshot_time or "")


def _has_valid_snapshot_time(snapshot: dict[str, Any]) -> bool:
    snapshot_time = _text(snapshot.get("snapshot_time"))
    return snapshot_time is not None and _safe_parse_time(snapshot_time) is not None


def _replay_fallback_snapshot() -> dict[str, Any]:
    return {
        "session_id": "unknown-session",
        "expiry": "1970-01-01",
        "snapshot_time": _now(),
    }


def _safe_parse_time(value: str) -> datetime | None:
    try:
        return _parse_time(value)
    except ValueError:
        return None


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number
