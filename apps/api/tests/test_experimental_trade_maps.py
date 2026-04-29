import pytest

from gammascope_api.experimental.trade_maps import decay_pressure_panel, move_needed_panel, rich_cheap_panel


def row(right: str, strike: float, mid: float) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": max(0, mid - 0.05),
        "ask": mid + 0.05,
        "mid": mid,
        "custom_iv": 0.2,
        "calc_status": "ok",
    }


def test_move_needed_panel_labels_expected_move_ratios() -> None:
    panel = move_needed_panel([row("call", 105, 2), row("put", 95, 1.5)], spot=100, expected_move=10)

    assert panel["status"] == "ok"
    assert panel["rows"][0]["breakeven"] == 107
    assert panel["rows"][0]["expectedMoveRatio"] == pytest.approx(0.7)
    assert panel["rows"][0]["label"] == "Within expected move"


def test_decay_pressure_panel_reports_static_points_per_minute() -> None:
    panel = decay_pressure_panel([row("call", 105, 2.0)], minutes_to_expiry=20)

    assert panel["status"] == "preview"
    assert panel["rows"][0]["pointsPerMinute"] == pytest.approx(0.1)


def test_rich_cheap_panel_compares_actual_mid_to_fitted_fair() -> None:
    iv_panel = {"methods": [{"key": "spline_fit", "points": [{"x": 105, "y": 0.2}]}]}
    panel = rich_cheap_panel([row("call", 105, 2.0)], iv_panel=iv_panel, forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["rows"][0]["strike"] == 105
    assert panel["rows"][0]["label"] in {"Rich", "Cheap", "Inline"}
