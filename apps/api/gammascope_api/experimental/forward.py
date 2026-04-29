from __future__ import annotations

from datetime import UTC, datetime, time
from math import exp
from statistics import median
from typing import Any

from gammascope_api.experimental.models import diagnostic, optional_float, panel
from gammascope_api.experimental.quality import grouped_pairs, quote_flags

EXPIRY_CUTOFF_UTC = time(hour=20, minute=0, tzinfo=UTC)
MIN_TAU_YEARS = 1 / (365 * 24 * 60 * 60)


def time_to_expiry_years(snapshot_time: str, expiry: str) -> float:
    try:
        snapshot_dt = _parse_datetime(snapshot_time)
        expiry_date = datetime.fromisoformat(expiry).date()
    except ValueError:
        return 0.0
    expiry_dt = datetime.combine(expiry_date, EXPIRY_CUTOFF_UTC)
    seconds = max((expiry_dt - snapshot_dt).total_seconds(), 0)
    return seconds / (365 * 24 * 60 * 60)


def forward_summary_panel(snapshot: dict[str, Any]) -> dict[str, Any]:
    spot = float(snapshot["spot"])
    rate = float(snapshot.get("risk_free_rate") or 0.0)
    tau = max(time_to_expiry_years(str(snapshot["snapshot_time"]), str(snapshot["expiry"])), MIN_TAU_YEARS)
    rows = list(snapshot.get("rows", []))
    forward_estimates: list[tuple[float, float]] = []

    for pair in grouped_pairs(rows):
        if pair.call is None or pair.put is None:
            continue
        if quote_flags(pair.call) or quote_flags(pair.put):
            continue
        call_mid = optional_float(pair.call.get("mid"))
        put_mid = optional_float(pair.put.get("mid"))
        if call_mid is None or put_mid is None:
            continue
        forward_estimates.append((pair.strike, pair.strike + exp(rate * tau) * (call_mid - put_mid)))

    if not forward_estimates:
        return panel(
            "insufficient_data",
            "Forward and expected move",
            [diagnostic("missing_pairs", "No clean call/put pairs are available.", "warning")],
            parityForward=None,
            forwardMinusSpot=None,
            atmStrike=None,
            atmStraddle=None,
            expectedRange=None,
            expectedMovePercent=None,
        )

    near_atm = sorted(forward_estimates, key=lambda item: abs(item[0] - spot))[:15]
    parity_forward = median(value for _, value in near_atm)
    atm_pair = min(grouped_pairs(rows), key=lambda pair: abs(pair.strike - parity_forward))
    atm_straddle = _pair_straddle(atm_pair.call, atm_pair.put)
    expected_range = None
    expected_move_percent = None
    if atm_straddle is not None:
        expected_range = {"lower": parity_forward - atm_straddle, "upper": parity_forward + atm_straddle}
        expected_move_percent = atm_straddle / parity_forward if parity_forward > 0 else None

    return panel(
        "ok",
        "Forward and expected move",
        [],
        parityForward=parity_forward,
        forwardMinusSpot=parity_forward - spot,
        atmStrike=atm_pair.strike,
        atmStraddle=atm_straddle,
        expectedRange=expected_range,
        expectedMovePercent=expected_move_percent,
    )


def _pair_straddle(call: dict[str, Any] | None, put: dict[str, Any] | None) -> float | None:
    if call is None or put is None:
        return None
    call_mid = optional_float(call.get("mid"))
    put_mid = optional_float(put.get("mid"))
    if call_mid is None or put_mid is None:
        return None
    return call_mid + put_mid


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
