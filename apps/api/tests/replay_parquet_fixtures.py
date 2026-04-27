from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq


EXPIRY = datetime(2026, 4, 24, 20, 0, tzinfo=timezone.utc)
MARKET_TIMES = [
    datetime(2026, 4, 24, 14, 30, tzinfo=timezone.utc),
    datetime(2026, 4, 24, 14, 31, tzinfo=timezone.utc),
    datetime(2026, 4, 24, 14, 32, tzinfo=timezone.utc),
]


def tiny_snapshot_rows() -> list[dict[str, Any]]:
    return [
        {
            "snapshot_id": f"snap-{index + 1}",
            "market_time": market_time,
            "expiry": EXPIRY,
            "spot": 5100.0 + index,
            "pricing_spot": 5100.25 + index,
            "forward_price": 5101.0 + index,
            "t_minutes": 330.0 - index,
            "risk_free_rate": 0.0525,
            "selected_strike_count": 2,
            "valid_mid_contract_count": 4,
            "stale_contract_count": 0,
            "row_count": 999,
        }
        for index, market_time in enumerate(MARKET_TIMES)
    ]


def tiny_quote_rows(snapshot_rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    snapshots = tiny_snapshot_rows() if snapshot_rows is None else snapshot_rows
    quotes: list[dict[str, Any]] = []
    for snapshot in snapshots:
        for strike in (5095.0, 5100.0):
            for option_type in ("C", "P"):
                quotes.append(
                    {
                        "snapshot_id": snapshot["snapshot_id"],
                        "market_time": snapshot["market_time"],
                        "expiry": snapshot["expiry"],
                        "strike": strike,
                        "option_type": option_type,
                        "bid": 10.0 if option_type == "C" else 8.0,
                        "ask": 10.5 if option_type == "C" else 8.5,
                        "mid": 10.25 if option_type == "C" else 8.25,
                        "iv": 0.18,
                        "oi": 123,
                        "quote_valid": True,
                        "ln_kf": 0.01,
                        "distance_from_atm": 5.0,
                    }
                )
    if quotes:
        quotes[-1]["bid"] = None
        quotes[-1]["ask"] = None
        quotes[-1]["mid"] = None
        quotes[-1]["quote_valid"] = False
    return quotes


def write_replay_parquet_pair(
    tmp_path: Path,
    *,
    snapshots: list[dict[str, Any]] | None = None,
    quotes: list[dict[str, Any]] | None = None,
    mutate_snapshots: Callable[[list[dict[str, Any]]], None] | None = None,
    mutate_quotes: Callable[[list[dict[str, Any]]], None] | None = None,
) -> tuple[Path, Path]:
    snapshot_rows = tiny_snapshot_rows() if snapshots is None else snapshots
    quote_rows = tiny_quote_rows(snapshot_rows) if quotes is None else quotes
    if mutate_snapshots is not None:
        mutate_snapshots(snapshot_rows)
    if mutate_quotes is not None:
        mutate_quotes(quote_rows)

    snapshots_path = tmp_path / "snapshots.parquet"
    quotes_path = tmp_path / "quotes.parquet"
    pq.write_table(pa.Table.from_pylist(snapshot_rows), snapshots_path)
    pq.write_table(pa.Table.from_pylist(quote_rows), quotes_path)
    return snapshots_path, quotes_path
