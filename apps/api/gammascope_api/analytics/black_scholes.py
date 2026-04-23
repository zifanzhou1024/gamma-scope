"""Black-Scholes-Merton analytics for European-style SPX index options.

The formulas follow the project spec's forward/discount-factor convention:

    F = S * exp((r - q) * tau)
    DF = exp(-r * tau)

Volatility is annualized decimal volatility. Gamma is per one index point.
Vanna is calculated as raw delta change per 1.00 volatility unit and can be
display-normalized per one volatility point by multiplying by 0.01.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import erf, exp, isfinite, log, pi, sqrt
from typing import Literal


OptionRight = Literal["call", "put"]
CalcStatus = Literal[
    "ok",
    "missing_quote",
    "invalid_quote",
    "below_intrinsic",
    "vol_out_of_bounds",
    "stale_underlying",
    "solver_failed",
    "out_of_model_scope",
]
ComparisonStatus = Literal["ok", "missing", "stale", "outside_tolerance", "not_supported"]

SIGMA_MIN = 0.0001
SIGMA_MAX = 8.5
MAX_SOLVER_ITERATIONS = 100


@dataclass(frozen=True)
class BlackScholesInputs:
    spot: float
    strike: float
    tau: float
    rate: float
    dividend_yield: float
    sigma: float


@dataclass(frozen=True)
class AnalyticsResult:
    custom_iv: float | None
    custom_gamma: float | None
    custom_vanna: float | None
    iv_diff: float | None
    gamma_diff: float | None
    calc_status: CalcStatus
    comparison_status: ComparisonStatus


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def normal_pdf(value: float) -> float:
    return exp(-0.5 * value * value) / sqrt(2.0 * pi)


def discount_factor(inputs: BlackScholesInputs) -> float:
    return exp(-inputs.rate * inputs.tau)


def forward_price(inputs: BlackScholesInputs) -> float:
    return inputs.spot * exp((inputs.rate - inputs.dividend_yield) * inputs.tau)


def d1_d2(inputs: BlackScholesInputs) -> tuple[float, float]:
    if not _is_model_input_valid(inputs):
        raise ValueError("Black-Scholes inputs must have positive spot, strike, tau, and sigma")

    sigma_root_tau = inputs.sigma * sqrt(inputs.tau)
    d1 = (log(forward_price(inputs) / inputs.strike) + 0.5 * inputs.sigma**2 * inputs.tau) / sigma_root_tau
    d2 = d1 - sigma_root_tau
    return d1, d2


def option_price(inputs: BlackScholesInputs, right: OptionRight) -> float:
    d1, d2 = d1_d2(inputs)
    forward = forward_price(inputs)
    df = discount_factor(inputs)

    if right == "call":
        return df * (forward * normal_cdf(d1) - inputs.strike * normal_cdf(d2))
    if right == "put":
        return df * (inputs.strike * normal_cdf(-d2) - forward * normal_cdf(-d1))

    raise ValueError(f"unsupported option right: {right}")


def gamma(inputs: BlackScholesInputs) -> float:
    d1, _ = d1_d2(inputs)
    carry_factor = discount_factor(inputs) * forward_price(inputs) / inputs.spot
    return carry_factor * normal_pdf(d1) / (inputs.spot * inputs.sigma * sqrt(inputs.tau))


def raw_vanna(inputs: BlackScholesInputs) -> float:
    d1, d2 = d1_d2(inputs)
    carry_factor = discount_factor(inputs) * forward_price(inputs) / inputs.spot
    return -carry_factor * normal_pdf(d1) * d2 / inputs.sigma


def display_vanna_per_vol_point(value: float) -> float:
    return value * 0.01


def mid_price(bid: float | None, ask: float | None) -> tuple[float | None, CalcStatus | None]:
    if bid is None or ask is None:
        return None, "missing_quote"
    if not isfinite(bid) or not isfinite(ask) or bid < 0 or ask < 0 or bid > ask:
        return None, "invalid_quote"
    return (bid + ask) / 2.0, None


def calculate_row_analytics(
    *,
    right: OptionRight,
    spot: float,
    strike: float,
    tau: float,
    rate: float,
    dividend_yield: float,
    bid: float | None,
    ask: float | None,
    ibkr_iv: float | None = None,
    ibkr_gamma: float | None = None,
) -> AnalyticsResult:
    mid, quote_error = mid_price(bid, ask)
    if quote_error is not None:
        return _empty_result(quote_error, ibkr_iv, ibkr_gamma)

    model_inputs = BlackScholesInputs(
        spot=spot,
        strike=strike,
        tau=tau,
        rate=rate,
        dividend_yield=dividend_yield,
        sigma=SIGMA_MIN,
    )
    if not _is_model_input_valid(model_inputs):
        return _empty_result("out_of_model_scope", ibkr_iv, ibkr_gamma)

    assert mid is not None
    price_tolerance = max(0.01, abs(mid) * 1e-4)
    intrinsic = discounted_intrinsic_value(model_inputs, right)
    if mid + price_tolerance < intrinsic:
        return _empty_result("below_intrinsic", ibkr_iv, ibkr_gamma)

    implied_vol, status = solve_implied_volatility(
        right=right,
        target_price=mid,
        inputs_without_sigma=model_inputs,
        tolerance=price_tolerance,
    )
    if implied_vol is None:
        return _empty_result(status, ibkr_iv, ibkr_gamma)

    solved_inputs = BlackScholesInputs(
        spot=spot,
        strike=strike,
        tau=tau,
        rate=rate,
        dividend_yield=dividend_yield,
        sigma=implied_vol,
    )
    custom_gamma = gamma(solved_inputs)
    custom_vanna = display_vanna_per_vol_point(raw_vanna(solved_inputs))

    return AnalyticsResult(
        custom_iv=implied_vol,
        custom_gamma=custom_gamma,
        custom_vanna=custom_vanna,
        iv_diff=implied_vol - ibkr_iv if ibkr_iv is not None else None,
        gamma_diff=custom_gamma - ibkr_gamma if ibkr_gamma is not None else None,
        calc_status="ok",
        comparison_status=_comparison_status(ibkr_iv, ibkr_gamma),
    )


def discounted_intrinsic_value(inputs: BlackScholesInputs, right: OptionRight) -> float:
    forward = forward_price(inputs)
    if right == "call":
        return discount_factor(inputs) * max(forward - inputs.strike, 0.0)
    if right == "put":
        return discount_factor(inputs) * max(inputs.strike - forward, 0.0)

    raise ValueError(f"unsupported option right: {right}")


def solve_implied_volatility(
    *,
    right: OptionRight,
    target_price: float,
    inputs_without_sigma: BlackScholesInputs,
    tolerance: float,
) -> tuple[float | None, CalcStatus]:
    low_inputs = _with_sigma(inputs_without_sigma, SIGMA_MIN)
    high_inputs = _with_sigma(inputs_without_sigma, SIGMA_MAX)
    low_price = option_price(low_inputs, right)
    high_price = option_price(high_inputs, right)

    if target_price < low_price - tolerance or target_price > high_price + tolerance:
        return None, "vol_out_of_bounds"

    low = SIGMA_MIN
    high = SIGMA_MAX
    candidate_price = low_price
    mid_sigma = low
    for _ in range(MAX_SOLVER_ITERATIONS):
        mid_sigma = (low + high) / 2.0
        candidate_inputs = _with_sigma(inputs_without_sigma, mid_sigma)
        candidate_price = option_price(candidate_inputs, right)
        error = candidate_price - target_price
        if high - low <= 1e-8:
            break
        if error > 0:
            high = mid_sigma
        else:
            low = mid_sigma

    if abs(candidate_price - target_price) <= tolerance:
        return mid_sigma, "ok"
    return None, "solver_failed"


def _with_sigma(inputs: BlackScholesInputs, sigma: float) -> BlackScholesInputs:
    return BlackScholesInputs(
        spot=inputs.spot,
        strike=inputs.strike,
        tau=inputs.tau,
        rate=inputs.rate,
        dividend_yield=inputs.dividend_yield,
        sigma=sigma,
    )


def _is_model_input_valid(inputs: BlackScholesInputs) -> bool:
    return (
        isfinite(inputs.spot)
        and isfinite(inputs.strike)
        and isfinite(inputs.tau)
        and isfinite(inputs.rate)
        and isfinite(inputs.dividend_yield)
        and isfinite(inputs.sigma)
        and inputs.spot > 0
        and inputs.strike > 0
        and inputs.tau > 0
        and inputs.sigma > 0
    )


def _empty_result(
    status: CalcStatus,
    ibkr_iv: float | None,
    ibkr_gamma: float | None,
) -> AnalyticsResult:
    return AnalyticsResult(
        custom_iv=None,
        custom_gamma=None,
        custom_vanna=None,
        iv_diff=None,
        gamma_diff=None,
        calc_status=status,
        comparison_status=_comparison_status(ibkr_iv, ibkr_gamma),
    )


def _comparison_status(ibkr_iv: float | None, ibkr_gamma: float | None) -> ComparisonStatus:
    if ibkr_iv is None and ibkr_gamma is None:
        return "missing"
    return "ok"
