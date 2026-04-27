from __future__ import annotations

import math
from typing import Any

import pytest

from gammascope_api.analytics.black_scholes import calculate_row_analytics
from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.replay.import_repository import ImportedSnapshotData, ImportedSnapshotHeader
from gammascope_api.replay.imported_snapshot import build_imported_analytics_snapshot
from gammascope_api.replay.parquet_reader import QuoteRecord


def test_build_imported_analytics_snapshot_validates_and_marks_partial_coverage() -> None:
    snapshot = _snapshot(
        quotes=[
            _quote(
                contract_id="SPX-20240216-C-102",
                right="call",
                strike=102.0,
                bid=0.42,
                ask=0.58,
                ibkr_iv=0.21,
                open_interest=7,
            ),
            _quote(
                contract_id="SPX-20240216-P-100",
                right="put",
                strike=100.0,
                bid=0.70,
                ask=0.60,
                ibkr_iv=0.33,
            ),
        ]
    )

    payload = build_imported_analytics_snapshot(snapshot)
    validated = AnalyticsSnapshot.model_validate(payload)

    assert validated.mode.value == "replay"
    assert validated.source_status.value == "connected"
    assert validated.coverage_status.value == "partial"
    assert validated.spot == 101.5
    assert validated.discount_factor == pytest.approx(
        math.exp(-snapshot.header.risk_free_rate * (snapshot.header.t_minutes / (365 * 24 * 60)))
    )

    ok_row = payload["rows"][0]
    assert ok_row["mid"] == 0.5
    assert ok_row["ibkr_iv"] == 0.21
    assert ok_row["ibkr_gamma"] is None
    assert ok_row["ibkr_vanna"] is None
    assert ok_row["calc_status"] == "ok"
    assert ok_row["comparison_status"] == "ok"

    expected = calculate_row_analytics(
        right="call",
        spot=101.5,
        strike=102.0,
        tau=snapshot.header.t_minutes / (365 * 24 * 60),
        rate=snapshot.header.risk_free_rate,
        dividend_yield=payload["dividend_yield"],
        bid=0.42,
        ask=0.58,
        ibkr_iv=0.21,
        ibkr_gamma=None,
    )
    assert ok_row["custom_iv"] == pytest.approx(expected.custom_iv)
    assert ok_row["custom_gamma"] == pytest.approx(expected.custom_gamma)
    assert ok_row["custom_vanna"] == pytest.approx(expected.custom_vanna)

    invalid_row = payload["rows"][1]
    assert invalid_row["calc_status"] == "invalid_quote"
    assert invalid_row["custom_iv"] is None
    assert invalid_row["custom_gamma"] is None
    assert invalid_row["custom_vanna"] is None


def test_build_imported_analytics_snapshot_marks_full_coverage_when_all_rows_calculate() -> None:
    payload = build_imported_analytics_snapshot(
        _snapshot(
            quotes=[
                _quote(contract_id="SPX-20240216-C-102", right="call", strike=102.0, bid=0.30, ask=0.44),
                _quote(contract_id="SPX-20240216-P-101", right="put", strike=101.0, bid=0.28, ask=0.40),
            ]
        )
    )

    AnalyticsSnapshot.model_validate(payload)
    assert payload["coverage_status"] == "full"
    assert {row["calc_status"] for row in payload["rows"]} == {"ok"}


def test_build_imported_analytics_snapshot_marks_empty_coverage_for_no_rows() -> None:
    payload = build_imported_analytics_snapshot(_snapshot(quotes=[]))

    AnalyticsSnapshot.model_validate(payload)
    assert payload["coverage_status"] == "empty"
    assert payload["rows"] == []


def test_build_imported_analytics_snapshot_marks_missing_quotes_visible() -> None:
    payload = build_imported_analytics_snapshot(
        _snapshot(
            pricing_spot=None,
            quotes=[
                _quote(
                    contract_id="SPX-20240216-C-102",
                    right="call",
                    strike=102.0,
                    bid=None,
                    ask=None,
                    ibkr_iv=None,
                )
            ],
        )
    )

    AnalyticsSnapshot.model_validate(payload)
    assert payload["spot"] == 100.0
    assert payload["coverage_status"] == "partial"
    assert payload["rows"][0]["mid"] is None
    assert payload["rows"][0]["calc_status"] == "missing_quote"
    assert payload["rows"][0]["comparison_status"] == "missing"


def test_build_imported_analytics_snapshot_marks_source_invalid_quotes_visible() -> None:
    payload = build_imported_analytics_snapshot(
        _snapshot(
            quotes=[
                _quote(contract_id="SPX-20240216-C-102", right="call", strike=102.0, bid=0.30, ask=0.44),
                _quote(
                    contract_id="SPX-20240216-P-101",
                    right="put",
                    strike=101.0,
                    bid=0.28,
                    ask=0.40,
                    quote_valid=False,
                ),
            ]
        )
    )

    AnalyticsSnapshot.model_validate(payload)
    assert payload["coverage_status"] == "partial"
    invalid_row = payload["rows"][1]
    assert invalid_row["mid"] == 0.34
    assert invalid_row["calc_status"] == "invalid_quote"
    assert invalid_row["custom_iv"] is None
    assert invalid_row["custom_gamma"] is None
    assert invalid_row["custom_vanna"] is None


def _snapshot(
    *,
    quotes: list[QuoteRecord],
    pricing_spot: float | None = 101.5,
    t_minutes: float = 60.0,
) -> ImportedSnapshotData:
    return ImportedSnapshotData(
        header=ImportedSnapshotHeader(
            session_id="import-session-1",
            source_snapshot_id="snap-1",
            source_order=0,
            snapshot_time="2024-02-15T19:00:00+00:00",
            expiry="2024-02-16",
            spot=100.0,
            pricing_spot=pricing_spot,
            forward=101.6 if pricing_spot is not None else 100.1,
            risk_free_rate=0.05,
            t_minutes=t_minutes,
            selected_strike_count=len(quotes),
            valid_mid_contract_count=sum(1 for quote in quotes if quote.quote_valid),
            stale_contract_count=0,
            row_count=len(quotes),
        ),
        quotes=quotes,
    )


def _quote(**overrides: Any) -> QuoteRecord:
    values = {
        "session_id": "import-session-1",
        "source_snapshot_id": "snap-1",
        "source_order": 0,
        "contract_id": "SPX-20240216-C-100",
        "strike": 100.0,
        "right": "call",
        "bid": 0.42,
        "ask": 0.58,
        "mid": 0.5,
        "ibkr_iv": 0.21,
        "open_interest": 10,
        "quote_valid": True,
        "ln_kf": None,
        "distance_from_atm": None,
    }
    values.update(overrides)
    return QuoteRecord(**values)
