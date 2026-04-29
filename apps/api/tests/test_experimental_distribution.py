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


def test_distribution_panels_sanitize_bad_fit_points_without_raising() -> None:
    bad_panel = {
        "methods": [
            {
                "key": "spline_fit",
                "points": [
                    {"x": 95, "y": 0.0},
                    {"x": "bad", "y": 0.2},
                    {"x": 100, "y": None},
                    {"x": 105, "y": 0.21},
                ],
            }
        ]
    }

    assert probability_panel(bad_panel, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert terminal_distribution_panel(bad_panel, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert skew_tail_panel(bad_panel, forward=100)["status"] == "insufficient_data"


def test_distribution_panels_sanitize_malformed_fit_containers_without_raising() -> None:
    panels = [
        {"methods": None},
        {"methods": [None]},
        {"methods": [{"key": "spline_fit", "points": None}]},
        {"methods": [{"key": "spline_fit", "points": [None]}]},
    ]

    for panel in panels:
        assert probability_panel(panel, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
        assert terminal_distribution_panel(panel, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
        assert skew_tail_panel(panel, forward=100)["status"] == "insufficient_data"


def test_distribution_panels_degrade_on_invalid_model_inputs() -> None:
    assert probability_panel(fitted_iv_panel(), forward=0, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert probability_panel(fitted_iv_panel(), forward=float("nan"), tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert skew_tail_panel(fitted_iv_panel(), forward=float("nan"))["status"] == "insufficient_data"
    assert terminal_distribution_panel(fitted_iv_panel(), forward=100, tau=0, rate=0.0)["status"] == "insufficient_data"
    assert terminal_distribution_panel(fitted_iv_panel(), forward=100, tau=float("nan"), rate=0.0)["status"] == "insufficient_data"
    assert terminal_distribution_panel(fitted_iv_panel(), forward=100, tau=1 / 365, rate=float("nan"))["status"] == "insufficient_data"


def test_terminal_distribution_deduplicates_and_sorts_fit_points() -> None:
    panel = {
        "methods": [
            {
                "key": "spline_fit",
                "points": [
                    {"x": 105, "y": 0.21},
                    {"x": 95, "y": 0.22},
                    {"x": 100, "y": 0.18},
                    {"x": 100, "y": 0.19},
                ],
            }
        ]
    }

    output = terminal_distribution_panel(panel, forward=100, tau=1 / 365, rate=0.0)

    assert output["status"] == "preview"
    assert [point["x"] for point in output["density"]] == sorted(point["x"] for point in output["density"])
