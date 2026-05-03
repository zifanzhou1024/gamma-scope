from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any, Literal

Aggressor = Literal["buy", "weak_buy", "sell", "weak_sell", "unknown"]
Confidence = Literal["high", "medium", "low", "unknown"]

CONTRACT_MULTIPLIER = 100
GEX_ONE_PERCENT_MOVE = 0.01
AGGRESSOR_WEIGHTS: dict[Aggressor, float] = {
    "buy": 1.0,
    "weak_buy": 0.5,
    "sell": -1.0,
    "weak_sell": -0.5,
    "unknown": 0.0,
}


def classify_aggressor(current: Mapping[str, Any], previous: Mapping[str, Any] | None) -> Aggressor:
    last = _number(current.get("last"))

    if last is not None and previous is not None:
        previous_ask = _number(previous.get("ask"))
        previous_bid = _number(previous.get("bid"))
        if previous_ask is not None and last >= previous_ask:
            return "buy"
        if previous_bid is not None and last <= previous_bid:
            return "sell"

    if last is not None:
        current_ask = _number(current.get("ask"))
        current_bid = _number(current.get("bid"))
        if current_ask is not None and last >= current_ask:
            return "buy"
        if current_bid is not None and last <= current_bid:
            return "sell"

    if previous is not None:
        current_mark = _first_number(current, "mid", "last")
        previous_mark = _first_number(previous, "mid", "last")
        if current_mark is not None and previous_mark is not None:
            if current_mark > previous_mark:
                return "weak_buy"
            if current_mark < previous_mark:
                return "weak_sell"

    return "unknown"


def estimate_contract_flow(current: Mapping[str, Any], previous: Mapping[str, Any] | None, *, spot: float) -> dict[str, Any]:
    diagnostics = ["open_close_proxy_only"]
    current_volume = _number(current.get("volume"))
    previous_volume = _number(previous.get("volume")) if previous is not None else None

    if previous is None:
        diagnostics.append("missing_previous_snapshot")
    elif previous_volume is None:
        diagnostics.append("missing_previous_volume")
    if current_volume is None:
        diagnostics.append("missing_volume")
    if _number(current.get("last")) is None:
        diagnostics.append("missing_last")

    raw_volume_delta = 0 if previous is None or previous_volume is None else (current_volume or 0) - previous_volume
    if raw_volume_delta < 0:
        diagnostics.append("volume_reset")
    volume_delta = max(0, raw_volume_delta)
    if volume_delta == 0:
        diagnostics.append("no_volume_delta")

    aggressor = classify_aggressor(current, previous)
    if aggressor == "unknown":
        diagnostics.append("aggressor_unknown")

    delta = _number(current.get("ibkr_delta"))
    gamma = _number(current.get("custom_gamma"))
    vanna = _number(current.get("custom_vanna"))
    theta = _number(current.get("ibkr_theta"))
    if delta is None:
        diagnostics.append("missing_delta")
    if gamma is None:
        diagnostics.append("missing_gamma")
    if vanna is None:
        diagnostics.append("missing_vanna")
    if theta is None:
        diagnostics.append("missing_theta")

    if _crossed_quote(current):
        diagnostics.append("crossed_quote")
    spread_ratio = _spread_ratio(current)
    if spread_ratio is None:
        diagnostics.append("missing_spread")
    elif spread_ratio > 0.2:
        diagnostics.append("wide_spread")

    price = _price(current)
    if price is None:
        diagnostics.append("missing_price")
    signed_contracts = volume_delta * AGGRESSOR_WEIGHTS[aggressor]
    valid_spot = _number(spot)
    if valid_spot is None or valid_spot <= 0:
        valid_spot = None
        diagnostics.append("missing_spot")
    premium_flow = signed_contracts * (price or 0) * CONTRACT_MULTIPLIER
    delta_flow = signed_contracts * delta * valid_spot * CONTRACT_MULTIPLIER if delta is not None and valid_spot is not None else None
    gamma_flow = (
        signed_contracts * gamma * valid_spot * valid_spot * GEX_ONE_PERCENT_MOVE * CONTRACT_MULTIPLIER
        if gamma is not None and valid_spot is not None
        else None
    )
    vanna_flow = signed_contracts * vanna * valid_spot * CONTRACT_MULTIPLIER if vanna is not None and valid_spot is not None else None
    theta_flow = signed_contracts * theta * CONTRACT_MULTIPLIER if theta is not None else None
    opening_score, closing_score = _open_close_scores(current, volume_delta)
    confidence_score = _confidence_score(volume_delta, aggressor, diagnostics)

    return {
        "contractId": str(current.get("contract_id") or current.get("contractId") or ""),
        "right": current.get("right"),
        "strike": _number(current.get("strike")),
        "volumeDelta": volume_delta,
        "aggressor": aggressor,
        "signedContracts": signed_contracts,
        "premiumFlow": premium_flow,
        "deltaFlow": delta_flow,
        "gammaFlow": gamma_flow,
        "vannaFlow": vanna_flow,
        "thetaFlow": theta_flow,
        "openingScore": opening_score,
        "closingScore": closing_score,
        "confidence": confidence_label(confidence_score),
        "diagnostics": diagnostics,
    }


def estimate_flow(current_snapshot: Any, previous_snapshot: Any) -> dict[str, Any]:
    current_rows = [row for row in _rows(current_snapshot) if _valid_source_row(row)]
    previous_rows = {str(row.get("contract_id") or row.get("contractId")): row for row in _rows(previous_snapshot) if _valid_source_row(row)}
    spot = _first_number(current_snapshot, "spot", "underlyingPrice", "underlying_price") if isinstance(current_snapshot, Mapping) else None
    if spot is None:
        spot = 0

    contract_rows = [
        estimate_contract_flow(row, previous_rows.get(str(row.get("contract_id") or row.get("contractId"))), spot=spot)
        for row in current_rows
    ]
    return {
        "summary": _summary(contract_rows),
        "strikeRows": _strike_rows(contract_rows),
        "contractRows": contract_rows,
    }


def confidence_label(value: float) -> Confidence:
    if value >= 0.75:
        return "high"
    if value >= 0.45:
        return "medium"
    if value > 0:
        return "low"
    return "unknown"


def _rows(snapshot: Any) -> list[Mapping[str, Any]]:
    rows = snapshot.get("rows") if isinstance(snapshot, Mapping) else snapshot
    if not isinstance(rows, Iterable) or isinstance(rows, (str, bytes, Mapping)):
        return []
    return [row for row in rows if isinstance(row, Mapping)]


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _first_number(row: Mapping[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = _number(row.get(key))
        if value is not None:
            return value
    return None


def _crossed_quote(row: Mapping[str, Any]) -> bool:
    bid = _number(row.get("bid"))
    ask = _number(row.get("ask"))
    return bid is not None and ask is not None and bid > ask


def _spread_ratio(row: Mapping[str, Any]) -> float | None:
    bid = _number(row.get("bid"))
    ask = _number(row.get("ask"))
    mid = _first_number(row, "mid", "mark")
    if bid is None or ask is None or mid is None or mid <= 0:
        return None
    return (ask - bid) / mid


def _price(row: Mapping[str, Any]) -> float | None:
    for key in ("mid", "last", "bid", "ask"):
        price = _number(row.get(key))
        if price is not None and price > 0:
            return price
    return None


def _valid_source_row(row: Mapping[str, Any]) -> bool:
    contract_id = str(row.get("contract_id") or row.get("contractId") or "")
    strike = _number(row.get("strike"))
    return bool(contract_id) and row.get("right") in {"call", "put"} and strike is not None and strike > 0


def _open_close_scores(row: Mapping[str, Any], volume_delta: float) -> tuple[float, float]:
    open_interest = _number(row.get("open_interest"))
    if volume_delta <= 0 or open_interest is None or open_interest <= 0:
        return 0.0, 0.0
    opening_score = _clamp01(volume_delta / (volume_delta + open_interest))
    return opening_score, _clamp01(1 - opening_score)


def _confidence_score(volume_delta: float, aggressor: Aggressor, diagnostics: list[str]) -> float:
    if volume_delta <= 0 or aggressor == "unknown":
        return 0.0
    score = 0.9
    for code in diagnostics:
        if code in {
            "missing_last",
            "missing_previous_volume",
            "missing_previous_snapshot",
            "missing_spot",
        }:
            score -= 0.2
        elif code in {
            "missing_delta",
            "missing_gamma",
            "missing_price",
            "missing_spread",
            "crossed_quote",
            "wide_spread",
        }:
            score -= 0.15
        elif code.startswith("missing_"):
            score -= 0.05
    return _clamp01(score)


def _strike_rows(contract_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[float, list[dict[str, Any]]] = {}
    for row in contract_rows:
        strike = _number(row.get("strike"))
        if strike is not None:
            grouped.setdefault(strike, []).append(row)

    strike_rows = []
    for strike in sorted(grouped):
        rows = grouped[strike]
        net_gamma_flow = _sum_nullable(row["gammaFlow"] for row in rows)
        tags = sorted({tag for row in rows for tag in row["diagnostics"]})
        strike_rows.append(
            {
                "strike": strike,
                "callBuyContracts": sum(row["signedContracts"] for row in rows if row["right"] == "call" and row["signedContracts"] > 0),
                "callSellContracts": sum(-row["signedContracts"] for row in rows if row["right"] == "call" and row["signedContracts"] < 0),
                "putBuyContracts": sum(row["signedContracts"] for row in rows if row["right"] == "put" and row["signedContracts"] > 0),
                "putSellContracts": sum(-row["signedContracts"] for row in rows if row["right"] == "put" and row["signedContracts"] < 0),
                "netPremiumFlow": sum(row["premiumFlow"] for row in rows),
                "netDeltaFlow": _sum_nullable(row["deltaFlow"] for row in rows),
                "netGammaFlow": net_gamma_flow,
                "estimatedDealerGammaPressure": -net_gamma_flow if net_gamma_flow is not None else None,
                "openingScore": _clamp01(sum(row["openingScore"] for row in rows) / len(rows)),
                "closingScore": _clamp01(sum(row["closingScore"] for row in rows) / len(rows)),
                "confidence": confidence_label(sum(_confidence_value(row["confidence"]) for row in rows) / len(rows)),
                "tags": tags,
            }
        )
    return strike_rows


def _summary(contract_rows: list[dict[str, Any]]) -> dict[str, Any]:
    buy_contracts = sum(row["signedContracts"] for row in contract_rows if row["signedContracts"] > 0)
    sell_contracts = sum(-row["signedContracts"] for row in contract_rows if row["signedContracts"] < 0)
    net_gamma_flow = _sum_nullable(row["gammaFlow"] for row in contract_rows)
    return {
        "estimatedBuyContracts": buy_contracts,
        "estimatedSellContracts": sell_contracts,
        "netEstimatedContracts": buy_contracts - sell_contracts,
        "netPremiumFlow": sum(row["premiumFlow"] for row in contract_rows),
        "netDeltaFlow": _sum_nullable(row["deltaFlow"] for row in contract_rows),
        "netGammaFlow": net_gamma_flow,
        "estimatedDealerGammaPressure": -net_gamma_flow if net_gamma_flow is not None else None,
        "confidence": confidence_label(
            sum(_confidence_value(row["confidence"]) for row in contract_rows) / len(contract_rows) if contract_rows else 0.0
        ),
    }


def _sum_nullable(values: Iterable[float | None]) -> float | None:
    total = None
    for value in values:
        total = _add_nullable(total, value)
    return total


def _add_nullable(left: float | None, right: float | None) -> float | None:
    if right is None:
        return left
    if left is None:
        return right
    return left + right


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _confidence_value(confidence: Confidence) -> float:
    return {"high": 0.8, "medium": 0.5, "low": 0.2, "unknown": 0.0}[confidence]
