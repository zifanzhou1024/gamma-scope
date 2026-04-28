from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gammascope_api.heatmap.exposure import StrikeExposure
from gammascope_api.heatmap.nodes import derive_nodes
from gammascope_api.heatmap.normalization import (
    color_norms_by_strike,
    five_minute_bucket_start,
    market_date_new_york,
    percentile,
)


def test_derive_nodes_finds_kings_and_walls_for_active_metric() -> None:
    rows = [
        StrikeExposure(strike=7210, gex=50, vex=-90),
        StrikeExposure(strike=7220, gex=200, vex=-30),
        StrikeExposure(strike=7180, gex=-100, vex=5),
        StrikeExposure(strike=7190, gex=-200, vex=40),
        StrikeExposure(strike=7230, gex=20, vex=110),
    ]

    assert derive_nodes(rows, spot=7200, metric="gex") == {
        "king": {"strike": 7220, "value": 200},
        "positiveKing": {"strike": 7220, "value": 200},
        "negativeKing": {"strike": 7190, "value": -200},
        "aboveWall": {"strike": 7220, "value": 200},
        "belowWall": {"strike": 7190, "value": -200},
    }


def test_derive_nodes_uses_requested_vex_metric() -> None:
    rows = [
        StrikeExposure(strike=7190, gex=-500, vex=30),
        StrikeExposure(strike=7210, gex=10, vex=-90),
        StrikeExposure(strike=7220, gex=20, vex=120),
    ]

    nodes = derive_nodes(rows, spot=7200, metric="vex")

    assert nodes["king"] == {"strike": 7220, "value": 120}
    assert nodes["positiveKing"] == {"strike": 7220, "value": 120}
    assert nodes["negativeKing"] == {"strike": 7210, "value": -90}


def test_derive_nodes_returns_empty_shape_for_empty_rows() -> None:
    assert derive_nodes([], spot=7200, metric="gex") == {
        "king": None,
        "positiveKing": None,
        "negativeKing": None,
        "aboveWall": None,
        "belowWall": None,
    }


def test_derive_nodes_rejects_unsupported_metric() -> None:
    with pytest.raises(ValueError, match="unsupported heatmap metric: charm"):
        derive_nodes([StrikeExposure(strike=7200, gex=100)], spot=7200, metric="charm")  # type: ignore[arg-type]


def test_derive_nodes_returns_empty_shape_when_metric_has_no_signal() -> None:
    empty_shape = {
        "king": None,
        "positiveKing": None,
        "negativeKing": None,
        "aboveWall": None,
        "belowWall": None,
    }

    assert derive_nodes(
        [StrikeExposure(strike=7190, gex=0), StrikeExposure(strike=7210, gex=0)],
        spot=7200,
        metric="gex",
    ) == empty_shape
    assert derive_nodes(
        [StrikeExposure(strike=7190, gex=float("nan")), StrikeExposure(strike=7210, gex=float("inf"))],
        spot=7200,
        metric="gex",
    ) == empty_shape


def test_derive_nodes_skips_non_finite_strikes_and_metric_values() -> None:
    rows = [
        StrikeExposure(strike=float("nan"), gex=500),
        StrikeExposure(strike=float("inf"), gex=-600),
        StrikeExposure(strike=7190, gex=float("-inf")),
        StrikeExposure(strike=7210, gex=200),
    ]

    assert derive_nodes(rows, spot=7200, metric="gex") == {
        "king": {"strike": 7210, "value": 200},
        "positiveKing": {"strike": 7210, "value": 200},
        "negativeKing": None,
        "aboveWall": {"strike": 7210, "value": 200},
        "belowWall": None,
    }


def test_percentile_interpolates_and_returns_zero_for_empty_values() -> None:
    assert percentile([], 80) == 0
    assert percentile([10, 20, 30, 40], 80) == pytest.approx(34)
    assert percentile([0, 100], 95) == pytest.approx(95)


def test_percentile_ignores_non_finite_values() -> None:
    assert percentile([float("nan"), float("inf"), float("-inf")], 80) == 0
    assert percentile([10, float("nan"), 20, float("inf"), 30], 50) == pytest.approx(20)


def test_color_norms_by_strike_uses_percentile_scale_and_sqrt_curve() -> None:
    rows = [
        StrikeExposure(strike=7180, gex=0),
        StrikeExposure(strike=7190, gex=25),
        StrikeExposure(strike=7200, gex=-100),
        StrikeExposure(strike=7210, gex=400),
    ]

    norms = color_norms_by_strike(rows, "gex")

    assert norms[7180] == 0
    assert norms[7190] == pytest.approx((25 / 355) ** 0.5)
    assert norms[7200] == pytest.approx((100 / 355) ** 0.5)
    assert norms[7210] == 1


def test_color_norms_by_strike_maps_all_zero_values_to_zero() -> None:
    rows = [StrikeExposure(strike=7190, gex=0), StrikeExposure(strike=7200, gex=0)]

    assert color_norms_by_strike(rows, "gex") == {7190: 0, 7200: 0}


def test_color_norms_by_strike_rejects_unsupported_metric() -> None:
    with pytest.raises(ValueError, match="unsupported heatmap metric: charm"):
        color_norms_by_strike([StrikeExposure(strike=7200, gex=100)], "charm")


def test_color_norms_by_strike_skips_non_finite_strikes_and_metric_values() -> None:
    rows = [
        StrikeExposure(strike=float("nan"), gex=500),
        StrikeExposure(strike=float("inf"), gex=600),
        StrikeExposure(strike=7190, gex=float("nan")),
        StrikeExposure(strike=7200, gex=float("inf")),
        StrikeExposure(strike=7210, gex=100),
    ]

    assert color_norms_by_strike(rows, "gex") == {7210: 1}


def test_market_date_new_york_prevents_utc_midnight_drift() -> None:
    assert market_date_new_york("2026-04-29T02:30:00Z") == "2026-04-28"
    assert market_date_new_york(datetime(2026, 4, 29, 2, 30, tzinfo=timezone.utc)) == "2026-04-28"


def test_five_minute_bucket_start_floors_to_utc_bucket() -> None:
    assert five_minute_bucket_start("2026-04-28T14:09:59Z") == "2026-04-28T14:05:00Z"
    assert five_minute_bucket_start(datetime(2026, 4, 28, 14, 10, 0, tzinfo=timezone.utc)) == (
        "2026-04-28T14:10:00Z"
    )
