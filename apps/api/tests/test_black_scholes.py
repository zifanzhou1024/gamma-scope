import pytest

from gammascope_api.analytics.black_scholes import (
    BlackScholesInputs,
    calculate_row_analytics,
    display_vanna_per_vol_point,
    discount_factor,
    forward_price,
    gamma,
    option_price,
    raw_vanna,
)


BASE_INPUTS = BlackScholesInputs(
    spot=100.0,
    strike=100.0,
    tau=30 / 365,
    rate=0.05,
    dividend_yield=0.01,
    sigma=0.20,
)


def test_prices_options_with_forward_discount_factor_form() -> None:
    assert forward_price(BASE_INPUTS) == pytest.approx(100.3293081551)
    assert discount_factor(BASE_INPUTS) == pytest.approx(0.9958988438)
    assert option_price(BASE_INPUTS, "call") == pytest.approx(2.4492483009)
    assert option_price(BASE_INPUTS, "put") == pytest.approx(2.1212906899)


def test_call_put_prices_share_the_same_forward_convention() -> None:
    call_price = option_price(BASE_INPUTS, "call")
    put_price = option_price(BASE_INPUTS, "put")
    parity_value = discount_factor(BASE_INPUTS) * (forward_price(BASE_INPUTS) - BASE_INPUTS.strike)

    assert call_price - put_price == pytest.approx(parity_value)


def test_gamma_and_vanna_use_project_units() -> None:
    call_gamma = gamma(BASE_INPUTS)
    put_gamma = gamma(BASE_INPUTS)
    raw = raw_vanna(BASE_INPUTS)

    assert call_gamma == pytest.approx(0.0692632117)
    assert put_gamma == pytest.approx(call_gamma)
    assert raw == pytest.approx(-0.0569286672)
    assert display_vanna_per_vol_point(raw) == pytest.approx(-0.0005692867)


def test_calculate_row_analytics_recovers_known_implied_volatility() -> None:
    mid = option_price(BASE_INPUTS, "call")

    result = calculate_row_analytics(
        right="call",
        spot=BASE_INPUTS.spot,
        strike=BASE_INPUTS.strike,
        tau=BASE_INPUTS.tau,
        rate=BASE_INPUTS.rate,
        dividend_yield=BASE_INPUTS.dividend_yield,
        bid=mid - 0.05,
        ask=mid + 0.05,
        ibkr_iv=0.21,
        ibkr_gamma=0.0701,
    )

    assert result.calc_status == "ok"
    assert result.custom_iv == pytest.approx(0.20, abs=1e-4)
    assert result.custom_gamma == pytest.approx(0.0692632117)
    assert result.custom_vanna == pytest.approx(-0.0005692867)
    assert result.iv_diff == pytest.approx(-0.01, abs=1e-4)
    assert result.gamma_diff == pytest.approx(result.custom_gamma - 0.0701)


@pytest.mark.parametrize(
    ("bid", "ask", "expected_status"),
    [
        (None, 2.5, "missing_quote"),
        (2.4, None, "missing_quote"),
        (-0.1, 2.5, "invalid_quote"),
        (2.6, 2.5, "invalid_quote"),
    ],
)
def test_calculate_row_analytics_validates_quotes(
    bid: float | None,
    ask: float | None,
    expected_status: str,
) -> None:
    result = calculate_row_analytics(
        right="call",
        spot=BASE_INPUTS.spot,
        strike=BASE_INPUTS.strike,
        tau=BASE_INPUTS.tau,
        rate=BASE_INPUTS.rate,
        dividend_yield=BASE_INPUTS.dividend_yield,
        bid=bid,
        ask=ask,
    )

    assert result.calc_status == expected_status
    assert result.custom_iv is None
    assert result.custom_gamma is None
    assert result.custom_vanna is None


def test_calculate_row_analytics_rejects_mid_below_intrinsic() -> None:
    result = calculate_row_analytics(
        right="call",
        spot=100.0,
        strike=95.0,
        tau=30 / 365,
        rate=0.05,
        dividend_yield=0.01,
        bid=0.9,
        ask=1.1,
    )

    assert result.calc_status == "below_intrinsic"
    assert result.custom_iv is None


def test_calculate_row_analytics_rejects_prices_outside_vol_bounds() -> None:
    result = calculate_row_analytics(
        right="call",
        spot=BASE_INPUTS.spot,
        strike=BASE_INPUTS.strike,
        tau=BASE_INPUTS.tau,
        rate=BASE_INPUTS.rate,
        dividend_yield=BASE_INPUTS.dividend_yield,
        bid=90.0,
        ask=91.0,
    )

    assert result.calc_status == "vol_out_of_bounds"
    assert result.custom_iv is None
