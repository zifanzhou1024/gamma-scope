from gammascope_api.experimental.distribution import probability_panel, terminal_distribution_panel, skew_tail_panel


def fitted_iv_panel() -> dict:
    points = [{"x": 95, "y": 0.22}, {"x": 100, "y": 0.18}, {"x": 105, "y": 0.21}]
    return {"methods": [{"key": "spline_fit", "points": points}]}


def test_probability_panel_returns_risk_neutral_level_rows() -> None:
    panel = probability_panel(fitted_iv_panel(), forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["levels"][0]["strike"] == 95
    assert 0 <= panel["levels"][0]["closeAbove"] <= 1
    assert panel["diagnostics"][0]["code"] == "risk_neutral"


def test_terminal_distribution_panel_returns_density_and_ranges() -> None:
    panel = terminal_distribution_panel(fitted_iv_panel(), forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["density"]
    assert panel["highestDensityZone"] is not None
    assert panel["range68"] is not None
    assert panel["range95"] is not None


def test_distribution_panels_report_insufficient_data_without_fit() -> None:
    empty = {"methods": []}

    assert probability_panel(empty, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert terminal_distribution_panel(empty, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"


def test_skew_tail_panel_labels_left_tail_richness() -> None:
    panel = skew_tail_panel(fitted_iv_panel(), forward=100)

    assert panel["status"] == "preview"
    assert panel["tailBias"] in {"Left-tail rich", "Right-tail rich", "Balanced tails"}
