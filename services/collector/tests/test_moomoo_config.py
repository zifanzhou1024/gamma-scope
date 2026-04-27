from __future__ import annotations

import pytest

from gammascope_collector.moomoo_config import (
    DEFAULT_MOOMOO_HOST,
    DEFAULT_MOOMOO_PORT,
    MoomooCollectorConfig,
    MoomooSymbolConfig,
    chunked,
    default_moomoo_universe,
    estimate_snapshot_request_rate,
    parse_manual_spots,
    selected_symbols,
)


def test_default_universe_matches_moomoo_design() -> None:
    universe = default_moomoo_universe()

    assert DEFAULT_MOOMOO_HOST == "127.0.0.1"
    assert DEFAULT_MOOMOO_PORT == 11111
    assert [item.symbol for item in universe] == ["SPX", "SPY", "QQQ", "IWM", "RUT", "NDX"]
    assert {item.symbol: item.owner_code for item in universe} == {
        "SPX": "US..SPX",
        "SPY": "US.SPY",
        "QQQ": "US.QQQ",
        "IWM": "US.IWM",
        "RUT": "US..RUT",
        "NDX": "US..NDX",
    }
    assert {item.symbol: item.contract_count for item in universe} == {
        "SPX": 122,
        "SPY": 62,
        "QQQ": 62,
        "IWM": 42,
        "RUT": 82,
        "NDX": 202,
    }
    assert next(item for item in universe if item.symbol == "SPX").publish_to_spx_dashboard is True
    assert next(item for item in universe if item.symbol == "SPY").publish_to_spx_dashboard is False
    spx = next(item for item in universe if item.symbol == "SPX")
    assert spx.spot_proxy_code == "US.SPY"
    assert spx.spot_proxy_multiplier == 10.035
    assert spx.infer_spot_from_options is True
    assert [item.symbol for item in universe if item.requires_manual_spot] == ["RUT", "NDX"]


def test_collector_config_defaults_populate_moomoo_universe() -> None:
    config = MoomooCollectorConfig()

    assert config.host == "127.0.0.1"
    assert config.port == 11111
    assert config.refresh_interval_seconds == 2.0
    assert config.collector_id == "local-moomoo"
    assert config.api_base == "http://127.0.0.1:8000"
    assert config.manual_spots == {}
    assert [item.symbol for item in config.universe] == ["SPX", "SPY", "QQQ", "IWM", "RUT", "NDX"]


def test_manual_spots_parse_symbol_value_pairs() -> None:
    assert parse_manual_spots(["SPX=7050.25", "rut=2050", " NDX = 18300.5 "]) == {
        "SPX": 7050.25,
        "RUT": 2050.0,
        "NDX": 18300.5,
    }


@pytest.mark.parametrize(
    "value",
    ["SPX", "SPX=", "=7050", "SPX=abc", "SPX=-1", "SPX=0", "SPX=nan", "SPX=inf", "SPX=-inf"],
)
def test_manual_spots_reject_invalid_values(value: str) -> None:
    with pytest.raises(ValueError):
        parse_manual_spots([value])


def test_selected_symbols_filters_enabled_entries_and_overlays_manual_spots() -> None:
    config = MoomooCollectorConfig(
        manual_spots={"SPX": 7050.0},
        universe=[
            MoomooSymbolConfig(symbol="SPX", owner_code="US..SPX", strike_window_down=1, strike_window_up=1),
            MoomooSymbolConfig(symbol="SPY", owner_code="US.SPY", strike_window_down=1, strike_window_up=1, enabled=False),
        ],
    )

    symbols = selected_symbols(config)

    assert len(symbols) == 1
    assert symbols[0].symbol == "SPX"
    assert symbols[0].manual_spot == 7050.0


def test_chunked_splits_without_dropping_items() -> None:
    chunks = list(chunked([str(index) for index in range(805)], 400))

    assert [len(chunk) for chunk in chunks] == [400, 400, 5]
    assert chunks[0][0] == "0"
    assert chunks[-1][-1] == "804"


def test_snapshot_rate_math_for_default_universe_at_two_seconds() -> None:
    estimate = estimate_snapshot_request_rate(code_count=572, refresh_interval_seconds=2.0)

    assert estimate.codes == 572
    assert estimate.requests_per_refresh == 2
    assert estimate.requests_per_30_seconds == 30
    assert estimate.within_limit is True


def test_snapshot_rate_math_counts_live_spot_proxy_request() -> None:
    estimate = estimate_snapshot_request_rate(
        code_count=572,
        refresh_interval_seconds=2.0,
        extra_requests_per_refresh=1,
    )

    assert estimate.codes == 572
    assert estimate.extra_requests_per_refresh == 1
    assert estimate.requests_per_refresh == 3
    assert estimate.requests_per_30_seconds == 45
    assert estimate.within_limit is True


def test_snapshot_rate_math_accepts_positional_required_arguments() -> None:
    estimate = estimate_snapshot_request_rate(572, 2.0)

    assert estimate.codes == 572
    assert estimate.requests_per_refresh == 2
    assert estimate.requests_per_30_seconds == 30
    assert estimate.within_limit is True


def test_snapshot_rate_math_rejects_zero_interval() -> None:
    with pytest.raises(ValueError):
        estimate_snapshot_request_rate(code_count=1, refresh_interval_seconds=0)
