from __future__ import annotations

from typing import Any

from gammascope_api.experimental.models import StrikePair, diagnostic, optional_float, panel

MAX_RELATIVE_SPREAD = 0.40


def grouped_pairs(rows: list[dict[str, Any]]) -> list[StrikePair]:
    grouped: dict[float, dict[str, dict[str, Any] | None]] = {}
    for row in rows:
        strike = optional_float(row.get("strike"))
        if strike is None:
            continue
        bucket = grouped.setdefault(strike, {"call": None, "put": None})
        if row.get("right") == "call":
            bucket["call"] = row
        elif row.get("right") == "put":
            bucket["put"] = row
    return [
        StrikePair(strike=strike, call=bucket["call"], put=bucket["put"])
        for strike, bucket in sorted(grouped.items())
    ]


def quote_quality_panel(rows: list[dict[str, Any]]) -> dict[str, Any]:
    flags: list[dict[str, Any]] = []
    usable_rows = 0
    for row in rows:
        row_flags = quote_flags(row)
        flags.extend(row_flags)
        if not row_flags:
            usable_rows += 1

    score = usable_rows / len(rows) if rows else 0.0
    status = "ok" if score >= 0.8 else "preview" if rows else "insufficient_data"
    diagnostics = [] if rows else [diagnostic("empty_chain", "No option rows are available.", "warning")]
    return panel(status, "Quote quality", diagnostics, score=round(score, 4), flags=flags)


def quote_flags(row: dict[str, Any]) -> list[dict[str, Any]]:
    bid = optional_float(row.get("bid"))
    ask = optional_float(row.get("ask"))
    strike = optional_float(row.get("strike"))
    right = str(row.get("right") or "pair")
    flags: list[dict[str, Any]] = []

    if strike is None:
        return [_flag(0.0, right, "invalid_strike", "Strike is missing or invalid.")]

    if bid is None or ask is None:
        return [_flag(strike, right, "missing_bid_ask", "Bid or ask is missing.")]
    if ask < bid:
        flags.append(_flag(strike, right, "crossed_market", "Bid is above ask."))
    if bid <= 0:
        flags.append(_flag(strike, right, "zero_bid", "Bid is zero or negative."))

    mid = (bid + ask) / 2
    if mid > 0 and (ask - bid) / mid > MAX_RELATIVE_SPREAD:
        flags.append(_flag(strike, right, "wide_spread", "Spread is wider than 40% of midpoint."))

    if row.get("calc_status") == "below_intrinsic":
        flags.append(_flag(strike, right, "below_intrinsic", "Midpoint is below discounted intrinsic value."))
    if row.get("calc_status") in {"vol_out_of_bounds", "solver_failed"}:
        flags.append(_flag(strike, right, str(row["calc_status"]), "IV solve is unusable."))

    return flags


def _flag(strike: float, right: str, code: str, message: str) -> dict[str, Any]:
    return {"strike": strike, "right": right, "code": code, "message": message}
