import pytest

from gammascope_api.contracts.generated.experimental_flow import ContractFlowRow
from gammascope_api.experimental_flow.estimator import (
    classify_aggressor,
    confidence_label,
    estimate_contract_flow,
    estimate_flow,
)


def row(
    contract_id: str = "SPX-5200-C",
    right: str = "call",
    strike: float = 5200,
    bid: float | None = 9.8,
    ask: float | None = 10.2,
    mid: float | None = 10,
    last: float | None = 10.3,
    bid_size: int | None = 12,
    ask_size: int | None = 8,
    volume: int | None = 140,
    open_interest: int | None = 500,
    custom_iv: float | None = 0.18,
    custom_gamma: float | None = 0.017,
    custom_vanna: float | None = 0.002,
    ibkr_delta: float | None = 0.51,
    ibkr_vega: float | None = 2.0,
    ibkr_theta: float | None = -1.25,
) -> dict:
    return {
        "contract_id": contract_id,
        "right": right,
        "strike": strike,
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "last": last,
        "bid_size": bid_size,
        "ask_size": ask_size,
        "volume": volume,
        "open_interest": open_interest,
        "custom_iv": custom_iv,
        "custom_gamma": custom_gamma,
        "custom_vanna": custom_vanna,
        "ibkr_delta": ibkr_delta,
        "ibkr_vega": ibkr_vega,
        "ibkr_theta": ibkr_theta,
    }


def test_classify_aggressor_uses_previous_and_current_quotes() -> None:
    previous = row(bid=9.8, ask=10.2, mid=10.0, last=10.0)

    assert classify_aggressor(row(bid=10.0, ask=10.4, mid=10.2, last=10.25), previous) == "buy"
    assert classify_aggressor(row(bid=9.6, ask=10.0, mid=9.8, last=9.75), previous) == "sell"
    assert classify_aggressor(row(bid=10.1, ask=10.5, mid=10.3, last=10.15), previous) == "weak_buy"
    assert classify_aggressor(row(bid=9.6, ask=10.4, mid=9.7, last=10.0), previous) == "weak_sell"
    assert classify_aggressor(row(bid=9.8, ask=10.2, mid=10.0, last=10.0), previous) == "unknown"


def test_classify_aggressor_uses_last_as_mark_fallback_for_weak_buy() -> None:
    previous = row(bid=9.0, ask=11.0, mid=None, last=9.8)
    current = row(bid=9.0, ask=11.0, mid=None, last=9.9)

    assert classify_aggressor(current, previous) == "weak_buy"


def test_classify_aggressor_uses_mid_for_weak_buy_when_last_is_missing() -> None:
    previous = row(bid=9.0, ask=11.0, mid=10.0, last=None)
    current = row(bid=9.0, ask=11.0, mid=10.1, last=None)

    assert classify_aggressor(current, previous) == "weak_buy"


def test_estimate_contract_flow_scores_signed_greeks_and_dealer_pressure() -> None:
    current = row(volume=140, last=10.25, bid=9.8, ask=10.2, mid=10, ibkr_delta=0.51, custom_gamma=0.017)
    previous = row(volume=100, last=10.0, bid=9.7, ask=10.1, mid=9.9)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["volumeDelta"] == 40
    assert result["aggressor"] == "buy"
    assert result["signedContracts"] == 40
    assert result["premiumFlow"] == pytest.approx(40000)
    assert result["deltaFlow"] == pytest.approx(10_608_000)
    assert result["gammaFlow"] == pytest.approx(18_387_200)
    assert "estimatedDealerGammaPressure" not in result
    assert result["confidence"] in {"high", "medium"}
    assert "open_close_proxy_only" in result["diagnostics"]


def test_contract_flow_rows_validate_against_generated_contract() -> None:
    current = row(volume=140, last=10.25, bid=9.8, ask=10.2, mid=10)
    previous = row(volume=100, last=10.0, bid=9.7, ask=10.1, mid=9.9)

    ContractFlowRow.model_validate(estimate_contract_flow(current, previous, spot=5200))

    payload = estimate_flow({"spot": 5200, "rows": [current]}, {"spot": 5200, "rows": [previous]})
    for contract_row in payload["contractRows"]:
        ContractFlowRow.model_validate(contract_row)


def test_estimate_contract_flow_treats_missing_previous_volume_delta_as_zero() -> None:
    current = row(volume=140, last=10.25, bid=9.8, ask=10.2, mid=10)

    result = estimate_contract_flow(current, None, spot=5200)

    assert result["volumeDelta"] == 0
    assert result["signedContracts"] == 0
    assert {"missing_previous_snapshot", "no_volume_delta"}.issubset(result["diagnostics"])
    assert result["confidence"] == "unknown"


def test_estimate_contract_flow_treats_missing_previous_volume_as_unavailable_delta() -> None:
    current = row(volume=140, last=10.25, bid=9.8, ask=10.2, mid=10)
    previous = row(volume=None, last=10.0, bid=9.7, ask=10.1, mid=9.9)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["volumeDelta"] == 0
    assert result["signedContracts"] == 0
    assert {"missing_previous_volume", "no_volume_delta"}.issubset(result["diagnostics"])
    assert result["confidence"] == "unknown"


def test_estimate_contract_flow_requires_valid_spot_for_spot_dependent_flows() -> None:
    current = row(volume=140, last=10.25, bid=9.8, ask=10.2, mid=10)
    previous = row(volume=100, last=10.0, bid=9.7, ask=10.1, mid=9.9)

    result = estimate_contract_flow(current, previous, spot=0)

    assert result["signedContracts"] == 40
    assert result["deltaFlow"] is None
    assert result["gammaFlow"] is None
    assert result["vannaFlow"] is None
    assert result["thetaFlow"] == pytest.approx(-5000)
    assert "missing_spot" in result["diagnostics"]
    assert result["confidence"] != "high"


def test_estimate_contract_flow_handles_missing_values_and_volume_resets() -> None:
    current = row(volume=80, last=None, custom_gamma=None, custom_vanna=None, ibkr_delta=None)
    previous = row(volume=100)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["volumeDelta"] == 0
    assert result["aggressor"] == "unknown"
    assert result["signedContracts"] == 0
    assert result["deltaFlow"] is None
    assert result["gammaFlow"] is None
    assert result["vannaFlow"] is None
    assert {"volume_reset", "missing_delta", "missing_gamma"}.issubset(result["diagnostics"])
    assert result["confidence"] == "unknown"


def test_estimate_contract_flow_marks_missing_last_without_breaking_weak_mid_classification() -> None:
    current = row(volume=140, bid=9.0, ask=11.0, mid=10.1, last=None)
    previous = row(volume=100, bid=9.0, ask=11.0, mid=10.0, last=None)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["aggressor"] == "weak_buy"
    assert result["signedContracts"] == 20
    assert "missing_last" in result["diagnostics"]
    assert result["confidence"] != "high"


def test_estimate_contract_flow_flags_missing_price_without_breaking_contract_shape() -> None:
    current = row(volume=140, bid=None, ask=None, mid=None, last=0)
    previous = row(volume=100, bid=9.7, ask=10.1, mid=9.9, last=10.0)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["signedContracts"] != 0
    assert result["premiumFlow"] == 0
    assert "missing_price" in result["diagnostics"]
    assert result["confidence"] == "medium"
    ContractFlowRow.model_validate(result)


def test_estimate_contract_flow_uses_bid_before_ask_for_price_fallback() -> None:
    current = row(volume=140, bid=9.8, ask=10.2, mid=None, last=0)
    previous = row(volume=100, bid=9.7, ask=10.1, mid=9.9, last=10.0)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["signedContracts"] == -40
    assert result["premiumFlow"] == pytest.approx(-40 * 9.8 * 100)
    assert "missing_price" not in result["diagnostics"]


def test_estimate_contract_flow_uses_ask_when_only_price_available() -> None:
    current = row(volume=140, bid=None, ask=10.2, mid=None, last=0)
    previous = row(volume=100, bid=9.7, ask=10.1, mid=9.9, last=10.0)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["signedContracts"] == -40
    assert result["premiumFlow"] == pytest.approx(-40 * 10.2 * 100)
    assert "missing_price" not in result["diagnostics"]


def test_estimate_contract_flow_ignores_generic_greek_fields() -> None:
    current = {
        **row(
            volume=140,
            last=10.25,
            bid=9.8,
            ask=10.2,
            mid=10,
            ibkr_delta=None,
            custom_gamma=None,
            custom_vanna=None,
            ibkr_theta=None,
        ),
        "delta": 0.51,
        "gamma": 0.017,
        "vanna": 0.002,
        "theta": -1.25,
    }
    previous = row(volume=100, last=10.0, bid=9.7, ask=10.1, mid=9.9)

    result = estimate_contract_flow(current, previous, spot=5200)

    assert result["deltaFlow"] is None
    assert result["gammaFlow"] is None
    assert result["vannaFlow"] is None
    assert result["thetaFlow"] is None
    assert {
        "missing_delta",
        "missing_gamma",
        "missing_vanna",
        "missing_theta",
    }.issubset(result["diagnostics"])


def test_estimate_flow_aggregates_contracts_by_strike_and_summary() -> None:
    current_rows = [
        row(contract_id="SPX-5200-C", right="call", strike=5200, volume=140, last=10.25, bid=9.8, ask=10.2),
        row(contract_id="SPX-5200-P", right="put", strike=5200, volume=65, last=8.7, bid=8.8, ask=9.2),
    ]
    previous_rows = [
        row(contract_id="SPX-5200-C", right="call", strike=5200, volume=100, bid=9.7, ask=10.1, mid=9.9),
        row(contract_id="SPX-5200-P", right="put", strike=5200, volume=50, bid=8.9, ask=9.3, mid=9.1),
    ]

    result = estimate_flow({"spot": 5200, "rows": current_rows}, {"spot": 5200, "rows": previous_rows})

    assert result["strikeRows"] == [
        {
            **result["strikeRows"][0],
            "strike": 5200,
            "callBuyContracts": 40,
            "callSellContracts": 0,
            "putBuyContracts": 0,
            "putSellContracts": 15,
        }
    ]
    assert result["summary"]["estimatedBuyContracts"] == 40
    assert result["summary"]["estimatedSellContracts"] == 15
    assert result["summary"]["netEstimatedContracts"] == 25


def test_estimate_flow_skips_rows_with_malformed_identity() -> None:
    current_rows = [
        row(contract_id="SPX-5200-C", right="call", strike=5200, volume=140, last=10.25, bid=9.8, ask=10.2),
        row(contract_id="", right="call", strike=5200, volume=140, last=10.25, bid=9.8, ask=10.2),
        row(contract_id="SPX-5200-X", right="bad", strike=5200, volume=140, last=10.25, bid=9.8, ask=10.2),
        row(contract_id="SPX-0-C", right="call", strike=0, volume=140, last=10.25, bid=9.8, ask=10.2),
        row(contract_id="SPX-MISSING-C", right="call", strike=None, volume=140, last=10.25, bid=9.8, ask=10.2),
    ]
    previous_rows = [
        row(contract_id="SPX-5200-C", right="call", strike=5200, volume=100, bid=9.7, ask=10.1, mid=9.9),
    ]

    payload = estimate_flow({"spot": 5200, "rows": current_rows}, {"spot": 5200, "rows": previous_rows})

    assert [contract_row["contractId"] for contract_row in payload["contractRows"]] == ["SPX-5200-C"]
    for contract_row in payload["contractRows"]:
        ContractFlowRow.model_validate(contract_row)


def test_confidence_label_uses_expected_thresholds() -> None:
    assert confidence_label(0.8) == "high"
    assert confidence_label(0.5) == "medium"
    assert confidence_label(0.2) == "low"
    assert confidence_label(0.0) == "unknown"
