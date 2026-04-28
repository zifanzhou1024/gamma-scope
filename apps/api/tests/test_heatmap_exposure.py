from __future__ import annotations

import pytest

from gammascope_api.heatmap.exposure import (
    CONTRACT_MULTIPLIER_SPX,
    HeatmapContractInput,
    aggregate_exposure_by_strike,
    format_money,
)


def _contract(
    *,
    contract_id: str,
    right: str,
    strike: float,
    open_interest: int | None,
    gamma: float | None,
    vanna: float | None,
) -> HeatmapContractInput:
    return HeatmapContractInput(
        contract_id=contract_id,
        right=right,
        strike=strike,
        baseline_open_interest=open_interest,
        custom_gamma=gamma,
        custom_vanna=vanna,
    )


def test_aggregate_exposure_uses_signed_oi_proxy_for_gex_and_vex() -> None:
    rows = aggregate_exposure_by_strike(
        [
            _contract(
                contract_id="SPX-2026-04-28-C-7200",
                right="call",
                strike=7200,
                open_interest=10,
                gamma=0.002,
                vanna=0.03,
            ),
            _contract(
                contract_id="SPX-2026-04-28-P-7200",
                right="put",
                strike=7200,
                open_interest=4,
                gamma=0.003,
                vanna=-0.02,
            ),
        ],
        spot=7000,
    )

    row = rows[0]
    spot_scale = CONTRACT_MULTIPLIER_SPX * 7000 * 7000 * 0.01
    assert row.strike == 7200
    assert row.call_gex == pytest.approx(10 * 0.002 * spot_scale)
    assert row.put_gex == pytest.approx(-4 * 0.003 * spot_scale)
    assert row.gex == pytest.approx(row.call_gex + row.put_gex)
    assert row.call_vex == pytest.approx(10 * CONTRACT_MULTIPLIER_SPX * 7000 * 0.03)
    assert row.put_vex == pytest.approx(-4 * CONTRACT_MULTIPLIER_SPX * 7000 * -0.02)
    assert row.vex == pytest.approx(row.call_vex + row.put_vex)
    assert row.tags == []


def test_aggregate_exposure_skips_missing_baseline_or_greeks_and_tags_row() -> None:
    rows = aggregate_exposure_by_strike(
        [
            _contract(
                contract_id="SPX-2026-04-28-C-7200",
                right="call",
                strike=7200,
                open_interest=None,
                gamma=0.002,
                vanna=0.03,
            ),
            _contract(
                contract_id="SPX-2026-04-28-P-7200",
                right="put",
                strike=7200,
                open_interest=4,
                gamma=None,
                vanna=None,
            ),
        ],
        spot=7000,
    )

    row = rows[0]
    assert row.gex == 0
    assert row.vex == 0
    assert row.call_gex == 0
    assert row.put_gex == 0
    assert "missing_oi_baseline" in row.tags
    assert "missing_greek" in row.tags


def test_aggregate_exposure_orders_strikes_ascending() -> None:
    rows = aggregate_exposure_by_strike(
        [
            _contract(contract_id="c-7210", right="call", strike=7210, open_interest=1, gamma=0.001, vanna=0.01),
            _contract(contract_id="c-7190", right="call", strike=7190, open_interest=1, gamma=0.001, vanna=0.01),
        ],
        spot=7000,
    )

    assert [row.strike for row in rows] == [7190, 7210]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "$0"),
        (125, "$125"),
        (-125, "-$125"),
        (12_400, "$12.4K"),
        (-12_400, "-$12.4K"),
        (12_400_000, "$12.4M"),
        (-12_400_000, "-$12.4M"),
        (1_240_000_000, "$1.2B"),
    ],
)
def test_format_money_compacts_signed_values(value: float, expected: str) -> None:
    assert format_money(value) == expected
