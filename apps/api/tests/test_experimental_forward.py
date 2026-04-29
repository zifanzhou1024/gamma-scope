import pytest

from gammascope_api.experimental.forward import forward_summary_panel, time_to_expiry_years


def row(right: str, strike: float, mid: float, bid: float | None = None, ask: float | None = None) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": bid if bid is not None else mid - 0.05,
        "ask": ask if ask is not None else mid + 0.05,
        "mid": mid,
        "calc_status": "ok",
    }


def test_time_to_expiry_years_uses_2000_utc_close() -> None:
    assert time_to_expiry_years("2026-04-23T19:00:00Z", "2026-04-23") == pytest.approx(1 / (365 * 24))


def test_forward_summary_uses_parity_median_and_forward_atm_straddle() -> None:
    snapshot = {
        "spot": 100.0,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("call", 95, 6.0),
            row("put", 95, 1.0),
            row("call", 100, 3.5),
            row("put", 100, 3.4),
            row("call", 105, 1.2),
            row("put", 105, 6.0),
        ],
    }

    panel = forward_summary_panel(snapshot)

    assert panel["status"] == "ok"
    assert panel["parityForward"] == pytest.approx(100.1)
    assert panel["forwardMinusSpot"] == pytest.approx(0.1)
    assert panel["atmStrike"] == 100
    assert panel["atmStraddle"] == pytest.approx(6.9)
    assert panel["expectedRange"] == {"lower": pytest.approx(93.2), "upper": pytest.approx(107.0)}
    assert panel["expectedMovePercent"] == pytest.approx(0.068931, rel=1e-4)


def test_forward_summary_reports_insufficient_data_without_pairs() -> None:
    panel = forward_summary_panel(
        {
            "spot": 100.0,
            "risk_free_rate": 0.0,
            "snapshot_time": "2026-04-23T19:00:00Z",
            "expiry": "2026-04-23",
            "rows": [row("call", 100, 3.5)],
        }
    )

    assert panel["status"] == "insufficient_data"
    assert panel["parityForward"] is None


def test_forward_summary_uses_nearest_clean_pair_for_atm_straddle() -> None:
    snapshot = {
        "spot": 100.0,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("call", 95, 6.0),
            row("put", 95, 1.0),
            row("call", 100, 3.5),
        ],
    }

    panel = forward_summary_panel(snapshot)

    assert panel["status"] == "ok"
    assert panel["atmStrike"] == 95
    assert panel["atmStraddle"] == pytest.approx(7.0)
    assert panel["expectedRange"] == {"lower": pytest.approx(93.0), "upper": pytest.approx(107.0)}
