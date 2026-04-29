import pytest

from gammascope_api.experimental.quality import grouped_pairs, quote_quality_panel


def row(
    contract_id: str,
    right: str,
    strike: float,
    bid: float | None,
    ask: float | None,
    mid: float | None = None,
) -> dict:
    return {
        "contract_id": contract_id,
        "right": right,
        "strike": strike,
        "bid": bid,
        "ask": ask,
        "mid": mid if mid is not None else ((bid + ask) / 2 if bid is not None and ask is not None else None),
        "custom_iv": 0.2,
        "ibkr_iv": 0.21,
        "custom_gamma": 0.01,
        "custom_vanna": 0.001,
        "open_interest": 100,
        "calc_status": "ok",
    }


def test_grouped_pairs_keeps_call_and_put_by_strike() -> None:
    pairs = grouped_pairs(
        [
            row("c-100", "call", 100, 4.9, 5.1),
            row("p-100", "put", 100, 4.8, 5.0),
            row("c-105", "call", 105, 2.0, 2.2),
        ]
    )

    assert [pair.strike for pair in pairs] == [100, 105]
    assert pairs[0].call["contract_id"] == "c-100"
    assert pairs[0].put["contract_id"] == "p-100"
    assert pairs[1].call["contract_id"] == "c-105"
    assert pairs[1].put is None


def test_quote_quality_flags_missing_crossed_zero_and_wide_quotes() -> None:
    panel = quote_quality_panel(
        [
            row("c-100", "call", 100, 4.9, 5.1),
            row("p-100", "put", 100, None, 5.0),
            row("c-105", "call", 105, 3.0, 2.9),
            row("p-105", "put", 105, 0.0, 0.1),
            row("c-110", "call", 110, 0.2, 1.2),
        ]
    )

    assert panel["status"] == "preview"
    assert panel["score"] == 0.2
    assert {flag["code"] for flag in panel["flags"]} == {
        "missing_bid_ask",
        "crossed_market",
        "zero_bid",
        "wide_spread",
    }


def test_quote_quality_flags_malformed_strikes_without_raising() -> None:
    panel = quote_quality_panel(
        [
            row("c-100", "call", 100, 4.9, 5.1),
            {**row("p-missing", "put", 0, 4.8, 5.0), "strike": None},
            {**row("c-bad", "call", 0, 2.0, 2.2), "strike": "bad"},
        ]
    )

    assert panel["status"] == "preview"
    assert panel["score"] == pytest.approx(0.3333)
    assert {flag["code"] for flag in panel["flags"]} == {"invalid_strike"}
