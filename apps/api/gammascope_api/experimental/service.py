from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime
from math import isfinite
from typing import Any, Callable, Literal

from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.experimental.distribution import probability_panel, skew_tail_panel, terminal_distribution_panel
from gammascope_api.experimental.forward import time_to_expiry_years, forward_summary_panel
from gammascope_api.experimental.iv_methods import build_iv_smiles_panel, smile_diagnostics_panel
from gammascope_api.experimental.models import diagnostic, optional_float, panel
from gammascope_api.experimental.quality import quote_quality_panel
from gammascope_api.experimental.trade_maps import decay_pressure_panel, move_needed_panel, rich_cheap_panel

ExperimentalMode = Literal["latest", "replay"]
PanelBuilder = Callable[[], dict[str, Any]]


def build_experimental_payload(snapshot: Any, mode: ExperimentalMode) -> dict[str, Any]:
    normalized = _normalize_snapshot(snapshot)
    rows = normalized["rows"]
    tau = normalized["time_to_expiry_years"]
    rate = normalized["risk_free_rate"]

    forward_summary = _safe_panel(
        lambda: forward_summary_panel(normalized),
        lambda: _empty_forward_summary_panel("Forward summary could not be built from available inputs."),
    )
    model_forward = _first_finite(
        forward_summary.get("parityForward"),
        normalized.get("forward"),
        normalized.get("spot"),
        default=0.0,
    )
    normalized["forward"] = model_forward

    iv_smiles = _safe_panel(
        lambda: build_iv_smiles_panel(normalized, forward_summary),
        lambda: _empty_iv_smiles_panel("IV smile methods could not be built from available inputs."),
    )
    smile_diagnostics = _safe_panel(
        lambda: smile_diagnostics_panel(iv_smiles, model_forward),
        lambda: _empty_smile_diagnostics_panel("Smile diagnostics could not be built from available inputs."),
    )
    probabilities = _safe_panel(
        lambda: probability_panel(iv_smiles, forward=model_forward, tau=tau, rate=rate),
        lambda: _empty_probabilities_panel("Probabilities could not be built from available inputs."),
    )
    terminal_distribution = _safe_panel(
        lambda: terminal_distribution_panel(iv_smiles, forward=model_forward, tau=tau, rate=rate),
        lambda: _empty_terminal_distribution_panel("Terminal distribution could not be built from available inputs."),
    )
    skew_tail = _safe_panel(
        lambda: skew_tail_panel(iv_smiles, forward=model_forward),
        lambda: _empty_skew_tail_panel("Skew and tail asymmetry could not be built from available inputs."),
    )
    move_needed = _safe_panel(
        lambda: move_needed_panel(rows, spot=normalized["spot"], expected_move=optional_float(forward_summary.get("atmStraddle"))),
        lambda: _empty_rows_panel("Move-needed map", "Move-needed map could not be built from available inputs."),
    )
    decay_pressure = _safe_panel(
        lambda: decay_pressure_panel(rows, minutes_to_expiry=tau * 365 * 24 * 60),
        lambda: _empty_rows_panel("Time-decay pressure", "Time-decay pressure could not be built from available inputs."),
    )
    rich_cheap = _safe_panel(
        lambda: rich_cheap_panel(rows, iv_panel=iv_smiles, forward=model_forward, tau=tau, rate=rate),
        lambda: _empty_rows_panel("Rich/cheap residuals", "Rich/cheap residuals could not be built from available inputs."),
    )
    quote_quality = _safe_panel(
        lambda: quote_quality_panel(rows),
        lambda: _empty_quote_quality_panel("Quote quality could not be built from available inputs."),
    )

    payload = {
        "schema_version": "1.0.0",
        "meta": {
            "generatedAt": _format_datetime(datetime.now(UTC)),
            "mode": mode if mode in {"latest", "replay"} else "latest",
            "sourceSessionId": normalized["source_session_id"],
            "sourceSnapshotTime": _format_datetime(normalized["source_snapshot_time"]),
            "symbol": "SPX",
            "expiry": normalized["expiry"],
        },
        "sourceSnapshot": {
            "spot": normalized["spot"],
            "forward": model_forward,
            "rowCount": len(rows),
            "strikeCount": _strike_count(rows),
            "timeToExpiryYears": tau,
        },
        "forwardSummary": forward_summary,
        "ivSmiles": iv_smiles,
        "smileDiagnostics": smile_diagnostics,
        "probabilities": probabilities,
        "terminalDistribution": terminal_distribution,
        "skewTail": skew_tail,
        "moveNeeded": move_needed,
        "decayPressure": decay_pressure,
        "richCheap": rich_cheap,
        "quoteQuality": quote_quality,
        "historyPreview": _empty_rows_panel("Range compression preview", "Select replay frames to compare history."),
    }
    return validate_experimental_payload(payload)


def validate_experimental_payload(payload: dict[str, Any]) -> dict[str, Any]:
    safe_payload = _repair_payload_schema(_scrub_nonfinite(payload))
    return ExperimentalAnalytics.model_validate(safe_payload).model_dump(mode="json")


def _normalize_snapshot(snapshot: Any) -> dict[str, Any]:
    source_snapshot_time = _coerce_datetime(_get(snapshot, "snapshot_time", "timestamp", "sourceSnapshotTime"))
    expiry = _coerce_expiry(_get(snapshot, "expiry", "expiration", "expiryDate", "expirationDate"), source_snapshot_time)
    spot = _finite_float(_get(snapshot, "spot"), default=0.0)
    forward = _finite_float(_get(snapshot, "forward"), default=spot)
    tau = _non_negative_float(_get(snapshot, "time_to_expiry_years", "timeToExpiryYears"))
    if tau is None:
        tau = time_to_expiry_years(_format_datetime(source_snapshot_time), expiry)
    rate = _finite_float(_get(snapshot, "risk_free_rate", "riskFreeRate"), default=0.0)

    return {
        "session_id": _source_session_id(snapshot),
        "source_session_id": _source_session_id(snapshot),
        "symbol": "SPX",
        "expiry": expiry,
        "snapshot_time": _format_datetime(source_snapshot_time),
        "source_snapshot_time": source_snapshot_time,
        "spot": spot,
        "forward": forward,
        "risk_free_rate": rate,
        "time_to_expiry_years": tau,
        "rows": _rows(snapshot),
    }


def _safe_panel(builder: PanelBuilder, empty: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return builder()
    except Exception:
        fallback = empty()
        fallback["diagnostics"] = [
            diagnostic("panel_unavailable", "Panel could not be built from available inputs.", "warning")
        ]
        return fallback


def _get(source: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(source, Mapping) and key in source:
            return source[key]
        if not isinstance(source, Mapping) and hasattr(source, key):
            return getattr(source, key)
    return None


def _source_session_id(snapshot: Any) -> str:
    for key in ("session_id", "snapshot_id", "source_snapshot_id", "source", "sourceSessionId"):
        value = _get(snapshot, key)
        if value is not None and str(value).strip():
            return str(value)
    return "unknown-session"


def _rows(snapshot: Any) -> list[dict[str, Any]]:
    raw_rows = _get(snapshot, "rows")
    if not isinstance(raw_rows, list):
        return []
    rows = []
    for row in raw_rows:
        if not isinstance(row, Mapping):
            continue
        clean = dict(row)
        if clean.get("right") not in {"call", "put"}:
            clean["right"] = None
        rows.append(clean)
    return rows


def _strike_count(rows: list[dict[str, Any]]) -> int:
    strikes = set()
    for row in rows:
        strike = optional_float(row.get("strike"))
        if strike is not None:
            strikes.add(strike)
    return len(strikes)


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return _aware_utc(value)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    if isinstance(value, str):
        try:
            return _aware_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            pass
    return datetime.now(UTC)


def _coerce_expiry(value: Any, fallback_time: datetime) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            pass
    return fallback_time.date().isoformat()


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _finite_float(value: Any, *, default: float) -> float:
    parsed = optional_float(value)
    return parsed if parsed is not None else default


def _non_negative_float(value: Any) -> float | None:
    parsed = optional_float(value)
    if parsed is None or parsed < 0:
        return None
    return parsed


def _first_finite(*values: Any, default: float) -> float:
    for value in values:
        parsed = optional_float(value)
        if parsed is not None:
            return parsed
    return default


def _scrub_nonfinite(value: Any) -> Any:
    if isinstance(value, float):
        return value if isfinite(value) else None
    if isinstance(value, list):
        return [_scrub_nonfinite(item) for item in value]
    if isinstance(value, dict):
        return {key: _scrub_nonfinite(item) for key, item in value.items()}
    return value


def _repair_payload_schema(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}

    source = _as_dict(payload.get("sourceSnapshot"))
    source["spot"] = _finite_or_default(source.get("spot"))
    source["forward"] = _finite_or_default(source.get("forward"))
    source["rowCount"] = _non_negative_int(source.get("rowCount"))
    source["strikeCount"] = _non_negative_int(source.get("strikeCount"))
    source["timeToExpiryYears"] = _finite_or_default(source.get("timeToExpiryYears"))
    payload["sourceSnapshot"] = source

    forward = _as_dict(payload.get("forwardSummary"))
    for key in ("parityForward", "forwardMinusSpot", "atmStrike", "atmStraddle", "expectedMovePercent"):
        forward[key] = _finite_or_none(forward.get(key))
    forward["expectedRange"] = _safe_expected_range(forward.get("expectedRange"))
    payload["forwardSummary"] = forward

    iv_smiles = _as_dict(payload.get("ivSmiles"))
    methods = iv_smiles.get("methods")
    if isinstance(methods, list):
        for method in methods:
            if isinstance(method, dict):
                method["points"] = _safe_points(method.get("points"))
    payload["ivSmiles"] = iv_smiles

    diagnostics = _as_dict(payload.get("smileDiagnostics"))
    valley = _as_dict(diagnostics.get("ivValley"))
    valley["strike"] = _finite_or_none(valley.get("strike"))
    valley["value"] = _finite_or_none(valley.get("value"))
    diagnostics["ivValley"] = valley
    for key in ("atmForwardIv", "skewSlope", "curvature", "methodDisagreement"):
        diagnostics[key] = _finite_or_none(diagnostics.get(key))
    payload["smileDiagnostics"] = diagnostics

    probabilities = _as_dict(payload.get("probabilities"))
    probabilities["levels"] = _safe_probability_levels(probabilities.get("levels"))
    payload["probabilities"] = probabilities

    terminal = _as_dict(payload.get("terminalDistribution"))
    terminal["density"] = _safe_points(terminal.get("density"))
    for key in ("leftTailProbability", "rightTailProbability"):
        terminal[key] = _finite_or_none(terminal.get(key))
    payload["terminalDistribution"] = terminal

    skew = _as_dict(payload.get("skewTail"))
    for key in ("leftTailRichness", "rightTailRichness"):
        skew[key] = _finite_or_none(skew.get(key))
    payload["skewTail"] = skew

    for key in ("moveNeeded", "decayPressure", "richCheap", "historyPreview"):
        panel_payload = _as_dict(payload.get(key))
        panel_payload["rows"] = _safe_rows(panel_payload.get("rows"))
        payload[key] = panel_payload

    quote_quality = _as_dict(payload.get("quoteQuality"))
    quote_quality["score"] = min(max(_finite_or_default(quote_quality.get("score")), 0.0), 1.0)
    quote_quality["flags"] = _safe_flags(quote_quality.get("flags"))
    payload["quoteQuality"] = quote_quality

    return payload


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite_or_none(value: Any) -> float | None:
    return optional_float(value)


def _finite_or_default(value: Any, default: float = 0.0) -> float:
    parsed = optional_float(value)
    return parsed if parsed is not None else default


def _non_negative_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(parsed, 0)


def _safe_expected_range(value: Any) -> dict[str, float] | None:
    if not isinstance(value, Mapping):
        return None
    lower = optional_float(value.get("lower"))
    upper = optional_float(value.get("upper"))
    if lower is None or upper is None:
        return None
    return {"lower": lower, "upper": upper}


def _safe_points(value: Any) -> list[dict[str, float | None]]:
    if not isinstance(value, list):
        return []
    points = []
    for point in value:
        if not isinstance(point, Mapping):
            continue
        x = optional_float(point.get("x"))
        if x is None:
            continue
        points.append({"x": x, "y": _finite_or_none(point.get("y"))})
    return points


def _safe_probability_levels(value: Any) -> list[dict[str, float | None]]:
    if not isinstance(value, list):
        return []
    levels = []
    for level in value:
        if not isinstance(level, Mapping):
            continue
        strike = optional_float(level.get("strike"))
        if strike is None:
            continue
        levels.append(
            {
                "strike": strike,
                "closeAbove": _finite_or_none(level.get("closeAbove")),
                "closeBelow": _finite_or_none(level.get("closeBelow")),
            }
        )
    return levels


def _safe_rows(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows = []
    for row in value:
        if not isinstance(row, Mapping):
            continue
        strike = optional_float(row.get("strike"))
        if strike is None:
            continue
        clean = dict(row)
        clean["strike"] = strike
        rows.append(clean)
    return rows


def _safe_flags(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    flags = []
    for flag in value:
        if not isinstance(flag, Mapping):
            continue
        strike = optional_float(flag.get("strike"))
        if strike is None:
            continue
        clean = dict(flag)
        clean["strike"] = strike
        flags.append(clean)
    return flags


def _empty_forward_summary_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Forward and expected move",
        [diagnostic("insufficient_data", message, "warning")],
        parityForward=None,
        forwardMinusSpot=None,
        atmStrike=None,
        atmStraddle=None,
        expectedRange=None,
        expectedMovePercent=None,
    )


def _empty_iv_smiles_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "IV smile methods",
        [diagnostic("insufficient_data", message, "warning")],
        methods=[],
    )


def _empty_smile_diagnostics_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Smile diagnostics",
        [diagnostic("insufficient_data", message, "warning")],
        ivValley={"strike": None, "value": None, "label": None},
        atmForwardIv=None,
        skewSlope=None,
        curvature=None,
        methodDisagreement=None,
    )


def _empty_probabilities_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Risk-neutral probabilities",
        [diagnostic("insufficient_data", message, "warning")],
        levels=[],
    )


def _empty_terminal_distribution_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Terminal distribution",
        [diagnostic("insufficient_data", message, "warning")],
        density=[],
        highestDensityZone=None,
        range68=None,
        range95=None,
        leftTailProbability=None,
        rightTailProbability=None,
    )


def _empty_skew_tail_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Skew and tail asymmetry",
        [diagnostic("insufficient_data", message, "warning")],
        tailBias=None,
        leftTailRichness=None,
        rightTailRichness=None,
    )


def _empty_rows_panel(label: str, message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        label,
        [diagnostic("insufficient_data", message, "info")],
        rows=[],
    )


def _empty_quote_quality_panel(message: str) -> dict[str, Any]:
    return panel(
        "insufficient_data",
        "Quote quality",
        [diagnostic("insufficient_data", message, "warning")],
        score=0.0,
        flags=[],
    )
