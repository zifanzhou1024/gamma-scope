from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
from typing import Literal


OptionRight = Literal["call", "put"]

CONTRACT_MULTIPLIER_SPX = 100
GEX_ONE_PERCENT_MOVE = 0.01
VEX_ONE_VOL_POINT = 0.01


@dataclass(frozen=True)
class HeatmapContractInput:
    contract_id: str
    right: OptionRight
    strike: float
    baseline_open_interest: int | None
    custom_gamma: float | None
    custom_vanna: float | None


@dataclass
class StrikeExposure:
    strike: float
    gex: float = 0
    vex: float = 0
    call_gex: float = 0
    put_gex: float = 0
    call_vex: float = 0
    put_vex: float = 0
    tags: list[str] = field(default_factory=list)


def aggregate_exposure_by_strike(
    contracts: list[HeatmapContractInput], spot: float, metric_mode: str = "proxy"
) -> list[StrikeExposure]:
    if metric_mode != "proxy":
        raise ValueError(f"unsupported heatmap metric_mode: {metric_mode}")

    rows_by_strike: dict[float, StrikeExposure] = {}
    spot_gex_scale = CONTRACT_MULTIPLIER_SPX * spot * spot * GEX_ONE_PERCENT_MOVE
    spot_vex_scale = CONTRACT_MULTIPLIER_SPX * spot * VEX_ONE_VOL_POINT

    for contract in contracts:
        row = rows_by_strike.setdefault(contract.strike, StrikeExposure(strike=contract.strike))

        missing_input = False
        if contract.baseline_open_interest is None:
            _append_tag(row, "missing_oi_baseline")
            missing_input = True
        elif not isfinite(contract.baseline_open_interest):
            _append_tag(row, "invalid_oi_baseline")
            missing_input = True
        if contract.custom_gamma is None or contract.custom_vanna is None:
            _append_tag(row, "missing_greek")
            missing_input = True
        elif not isfinite(contract.custom_gamma) or not isfinite(contract.custom_vanna):
            _append_tag(row, "invalid_greek")
            missing_input = True

        if missing_input:
            continue

        signed_oi = contract.baseline_open_interest if contract.right == "call" else -contract.baseline_open_interest
        gex = signed_oi * contract.custom_gamma * spot_gex_scale
        vex = signed_oi * contract.custom_vanna * spot_vex_scale

        if contract.right == "call":
            row.call_gex += gex
            row.call_vex += vex
        else:
            row.put_gex += gex
            row.put_vex += vex
        row.gex += gex
        row.vex += vex

    return [rows_by_strike[strike] for strike in sorted(rows_by_strike)]


def format_money(value: float) -> str:
    sign = "-" if value < 0 else ""
    magnitude = abs(value)

    for suffix, threshold in (("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)):
        if magnitude >= threshold:
            return f"{sign}${magnitude / threshold:.1f}{suffix}"

    return f"{sign}${magnitude:.0f}"


def _append_tag(row: StrikeExposure, tag: str) -> None:
    if tag not in row.tags:
        row.tags.append(tag)
