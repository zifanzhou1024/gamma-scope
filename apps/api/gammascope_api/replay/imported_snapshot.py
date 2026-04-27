from __future__ import annotations

import math
from typing import Any

from gammascope_api.analytics.black_scholes import calculate_row_analytics, mid_price
from gammascope_api.replay.import_repository import ImportedSnapshotData, ImportedSnapshotHeader
from gammascope_api.replay.parquet_reader import QuoteRecord


def build_imported_analytics_snapshot(snapshot: ImportedSnapshotData) -> dict[str, Any]:
    tau = time_to_expiry_years(snapshot.header.t_minutes)
    spot = snapshot.header.pricing_spot or snapshot.header.spot
    dividend_yield = infer_dividend_yield(
        spot=spot,
        forward=snapshot.header.forward,
        rate=snapshot.header.risk_free_rate,
        tau=tau,
    )
    discount_factor = math.exp(-snapshot.header.risk_free_rate * tau)
    rows = [build_imported_analytics_row(snapshot.header, quote) for quote in snapshot.quotes]

    return {
        "schema_version": "1.0.0",
        "session_id": snapshot.header.session_id,
        "mode": "replay",
        "symbol": "SPX",
        "expiry": snapshot.header.expiry,
        "snapshot_time": snapshot.header.snapshot_time,
        "spot": spot,
        "forward": snapshot.header.forward,
        "discount_factor": discount_factor,
        "risk_free_rate": snapshot.header.risk_free_rate,
        "dividend_yield": dividend_yield,
        "source_status": "connected",
        "freshness_ms": 0,
        "coverage_status": coverage_status(rows),
        "scenario_params": None,
        "rows": rows,
    }


def build_imported_analytics_row(header: ImportedSnapshotHeader, quote: QuoteRecord) -> dict[str, Any]:
    spot = header.pricing_spot or header.spot
    tau = time_to_expiry_years(header.t_minutes)
    dividend_yield = infer_dividend_yield(
        spot=spot,
        forward=header.forward,
        rate=header.risk_free_rate,
        tau=tau,
    )
    mid, _ = mid_price(quote.bid, quote.ask)
    if quote.quote_valid:
        result = calculate_row_analytics(
            right=quote.right,
            spot=spot,
            strike=quote.strike,
            tau=tau,
            rate=header.risk_free_rate,
            dividend_yield=dividend_yield,
            bid=quote.bid,
            ask=quote.ask,
            ibkr_iv=quote.ibkr_iv,
            ibkr_gamma=None,
        )
        custom_iv = result.custom_iv
        custom_gamma = result.custom_gamma
        custom_vanna = result.custom_vanna
        iv_diff = result.iv_diff
        gamma_diff = result.gamma_diff
        calc_status = result.calc_status
        comparison_status = result.comparison_status
    else:
        custom_iv = None
        custom_gamma = None
        custom_vanna = None
        iv_diff = None
        gamma_diff = None
        calc_status = "invalid_quote"
        comparison_status = "ok" if quote.ibkr_iv is not None else "missing"

    return {
        "contract_id": quote.contract_id,
        "right": quote.right,
        "strike": quote.strike,
        "bid": quote.bid,
        "ask": quote.ask,
        "mid": mid,
        "open_interest": quote.open_interest,
        "custom_iv": custom_iv,
        "custom_gamma": custom_gamma,
        "custom_vanna": custom_vanna,
        "ibkr_iv": quote.ibkr_iv,
        "ibkr_gamma": None,
        "ibkr_vanna": None,
        "iv_diff": iv_diff,
        "gamma_diff": gamma_diff,
        "calc_status": calc_status,
        "comparison_status": comparison_status,
    }


def time_to_expiry_years(t_minutes: float) -> float:
    return max(t_minutes, 1 / 60) / (365 * 24 * 60)


def infer_dividend_yield(*, spot: float, forward: float, rate: float, tau: float) -> float:
    if not all(math.isfinite(value) for value in (spot, forward, rate, tau)):
        return 0.0
    if spot <= 0 or forward <= 0 or tau <= 0:
        return 0.0
    return rate - (math.log(forward / spot) / tau)


def coverage_status(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "empty"
    if all(row["calc_status"] == "ok" for row in rows):
        return "full"
    return "partial"
