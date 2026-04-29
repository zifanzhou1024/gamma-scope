import pytest

from gammascope_api.experimental.iv_methods import (
    black76_price,
    build_iv_smiles_panel,
    implied_vol_black76,
    smile_diagnostics_panel,
)


def row(right: str, strike: float, mid: float, custom_iv: float = 0.2, ibkr_iv: float | None = 0.21) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": max(0.0, mid - 0.05),
        "ask": mid + 0.05,
        "mid": mid,
        "custom_iv": custom_iv,
        "ibkr_iv": ibkr_iv,
        "calc_status": "ok",
    }


def test_black76_iv_solver_recovers_known_vol() -> None:
    price = black76_price(forward=100, strike=100, tau=30 / 365, rate=0.05, sigma=0.25, right="call")

    assert implied_vol_black76(price=price, forward=100, strike=100, tau=30 / 365, rate=0.05, right="call") == pytest.approx(0.25, abs=1e-5)


def test_build_iv_smiles_panel_outputs_raw_and_fitted_methods() -> None:
    snapshot = {
        "spot": 100,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("put", 90, 0.25, 0.28),
            row("put", 95, 0.75, 0.22),
            row("call", 100, 3.0, 0.18),
            row("put", 100, 2.9, 0.18),
            row("call", 105, 0.9, 0.21),
            row("call", 110, 0.3, 0.26),
        ],
    }
    forward_summary = {"parityForward": 100.0, "atmStraddle": 5.9}

    panel = build_iv_smiles_panel(snapshot, forward_summary)

    assert panel["status"] == "preview"
    assert {method["key"] for method in panel["methods"]} >= {
        "custom_iv",
        "broker_iv",
        "otm_midpoint_black76",
        "atm_straddle_iv",
        "spline_fit",
        "quadratic_fit",
        "wing_weighted_fit",
        "last_price",
    }
    assert next(method for method in panel["methods"] if method["key"] == "last_price")["status"] == "insufficient_data"


def test_build_iv_smiles_panel_skips_malformed_rows_and_nonpositive_straddle_iv() -> None:
    snapshot = {
        "spot": 100,
        "forward": 100,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("call", 100, 3.0, 0.18),
            {**row("put", 0, 2.9, 0.18), "strike": "bad"},
        ],
    }
    forward_summary = {"parityForward": 100.0, "atmStrike": 100.0, "atmStraddle": 0.0}

    panel = build_iv_smiles_panel(snapshot, forward_summary)

    custom = next(method for method in panel["methods"] if method["key"] == "custom_iv")
    atm_straddle = next(method for method in panel["methods"] if method["key"] == "atm_straddle_iv")
    assert custom["points"] == [{"x": 100.0, "y": 0.18}]
    assert atm_straddle["status"] == "insufficient_data"
    assert atm_straddle["points"] == []


def test_smile_diagnostics_reports_valley_and_method_disagreement() -> None:
    iv_panel = {
        "methods": [
            {"key": "custom_iv", "points": [{"x": 95, "y": 0.22}, {"x": 100, "y": 0.18}, {"x": 105, "y": 0.21}]},
            {"key": "spline_fit", "points": [{"x": 95, "y": 0.215}, {"x": 100, "y": 0.175}, {"x": 105, "y": 0.205}]},
            {"key": "quadratic_fit", "points": [{"x": 95, "y": 0.216}, {"x": 100, "y": 0.176}, {"x": 105, "y": 0.206}]},
        ]
    }

    panel = smile_diagnostics_panel(iv_panel, forward=100)

    assert panel["status"] == "preview"
    assert panel["ivValley"] == {"strike": 100, "value": pytest.approx(0.175), "label": "Spline valley"}
    assert panel["atmForwardIv"] == pytest.approx(0.175)
    assert panel["methodDisagreement"] == pytest.approx(0.005)


def test_smile_diagnostics_reports_insufficient_data_for_malformed_spline_points() -> None:
    panel = smile_diagnostics_panel(
        {"methods": [{"key": "spline_fit", "points": [{"x": 100, "y": None}, {"x": "bad", "y": 0.2}]}]},
        forward=100,
    )

    assert panel["status"] == "insufficient_data"
    assert panel["ivValley"] == {"strike": None, "value": None, "label": None}
