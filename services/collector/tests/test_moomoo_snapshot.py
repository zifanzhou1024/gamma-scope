from __future__ import annotations

from datetime import date

import pytest

from gammascope_collector.moomoo_config import MoomooCollectorConfig, MoomooSymbolConfig
from gammascope_collector.moomoo_snapshot import (
    MoomooContract,
    collect_moomoo_snapshot_once,
    discover_symbol_contracts,
    main,
    normalize_snapshot_record,
    select_atm_strikes,
)


class FakeQuoteClient:
    def __init__(
        self,
        *,
        chains: dict[str, list[dict[str, object]]] | None = None,
        snapshots: dict[str, dict[str, object]] | None = None,
    ) -> None:
        self.chains = chains or {}
        self.snapshots = snapshots or {}
        self.option_chain_calls: list[tuple[str, str, str]] = []
        self.snapshot_calls: list[list[str]] = []
        self.closed = False

    def query_subscription(self, is_all_conn: bool = True) -> tuple[int, dict[str, object]]:
        return 0, {"is_all_conn": is_all_conn, "sub_list": ["US.SPY"]}

    def get_option_chain(self, code: str, start: str, end: str) -> tuple[int, list[dict[str, object]]]:
        self.option_chain_calls.append((code, start, end))
        return 0, self.chains.get(code, [])

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
        self.snapshot_calls.append(list(code_list))
        return 0, [self.snapshots[code] for code in code_list if code in self.snapshots]

    def close(self) -> None:
        self.closed = True


def _option(
    code: str,
    *,
    strike: float,
    option_type: str,
    expiry: str = "2026-04-27",
    name: str | None = None,
) -> dict[str, object]:
    return {
        "code": code,
        "name": name or code,
        "strike_price": strike,
        "option_type": option_type,
        "strike_time": expiry,
    }


def test_select_atm_strikes_keeps_asymmetric_down_up_window() -> None:
    strikes = select_atm_strikes([7030, 7040, 7050, 7060, 7070, 7080], spot=7054, down=1, up=2)

    assert strikes == [7040.0, 7050.0, 7060.0, 7070.0]


def test_discover_symbol_contracts_filters_family_and_selects_calls_and_puts_for_target_expiry() -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPX": [
                _option("US.SPXW240427C07040000", strike=7040, option_type="CALL", name="SPXW 7040C"),
                _option("US.SPXW240427P07040000", strike=7040, option_type="PUT", name="SPXW 7040P"),
                _option("US.SPXW240427C07050000", strike=7050, option_type="CALL", name="SPXW 7050C"),
                _option("US.SPXW240427P07050000", strike=7050, option_type="PUT", name="SPXW 7050P"),
                _option("US.SPX240427C07050000", strike=7050, option_type="CALL", name="SPX monthly 7050C"),
                _option("US.SPXW240428C07050000", strike=7050, option_type="CALL", expiry="2026-04-28", name="SPXW next"),
            ]
        }
    )
    symbol = MoomooSymbolConfig(
        symbol="SPX",
        owner_code="US.SPX",
        strike_window_down=0,
        strike_window_up=0,
        family_filter="SPXW",
        requires_manual_spot=True,
        manual_spot=7048,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert client.option_chain_calls == [("US.SPX", "2026-04-27", "2026-04-27")]
    assert result.spot == 7048.0
    assert [contract.option_code for contract in result.contracts] == [
        "US.SPXW240427C07050000",
        "US.SPXW240427P07050000",
    ]
    assert result.warnings == []


def test_family_filter_fallback_warns_and_uses_unfiltered_chain_when_filter_matches_zero_rows() -> None:
    client = FakeQuoteClient(
        chains={
            "US.RUT": [
                _option("US.RUT240427C02050000", strike=2050, option_type="CALL", name="RUT monthly 2050C"),
                _option("US.RUT240427P02050000", strike=2050, option_type="PUT", name="RUT monthly 2050P"),
            ]
        }
    )
    symbol = MoomooSymbolConfig(
        symbol="RUT",
        owner_code="US.RUT",
        strike_window_down=0,
        strike_window_up=0,
        family_filter="RUTW",
        requires_manual_spot=True,
        manual_spot=2051,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert [contract.option_code for contract in result.contracts] == [
        "US.RUT240427C02050000",
        "US.RUT240427P02050000",
    ]
    assert result.warnings == ["RUT family filter RUTW matched zero rows; using unfiltered chain"]


def test_missing_required_manual_spot_skips_symbol_without_fetching_option_chain() -> None:
    client = FakeQuoteClient()
    symbol = MoomooSymbolConfig(
        symbol="SPX",
        owner_code="US.SPX",
        strike_window_down=1,
        strike_window_up=1,
        requires_manual_spot=True,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert result.contracts == []
    assert result.spot is None
    assert result.warnings == ["SPX requires manual spot and none was supplied"]
    assert client.option_chain_calls == []


def test_normalize_snapshot_record_maps_moomoo_option_fields_into_option_row_dataclass() -> None:
    contract = MoomooContract(
        symbol="SPY",
        owner_code="US.SPY",
        option_code="US.SPY240427C00500000",
        option_type="CALL",
        strike=500.0,
        expiry=date(2026, 4, 27),
        name="SPY 500C",
    )

    row = normalize_snapshot_record(
        contract,
        {
            "code": "US.SPY240427C00500000",
            "name": "Snapshot name",
            "last_price": 1.25,
            "bid_price": 1.2,
            "ask_price": 1.3,
            "bid_volume": 11,
            "ask_volume": 12,
            "volume": 100,
            "open_interest": 200,
            "implied_volatility": 0.22,
            "delta": 0.51,
            "gamma": 0.02,
            "vega": 0.15,
            "theta": -0.04,
        },
    )

    assert row.symbol == "SPY"
    assert row.option_code == "US.SPY240427C00500000"
    assert row.option_type == "CALL"
    assert row.strike == 500.0
    assert row.expiry == date(2026, 4, 27)
    assert row.bid_price == 1.2
    assert row.ask_price == 1.3
    assert row.mid_price == 1.25
    assert row.open_interest == 200.0
    assert row.delta == 0.51


def test_collect_moomoo_snapshot_once_chunks_normalizes_and_reports_rate_estimate() -> None:
    contracts = [
        _option(f"US.SPY240427C{i:05d}", strike=400 + i, option_type="CALL", name=f"SPY {400 + i}C")
        for i in range(401)
    ]
    snapshots = {
        contract["code"]: {
            "code": contract["code"],
            "last_price": 1.0,
            "bid_price": 0.9,
            "ask_price": 1.1,
            "volume": 10,
        }
        for contract in contracts
    }
    client = FakeQuoteClient(
        chains={"US.SPY": contracts},
        snapshots=snapshots,
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=1,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=200,
                strike_window_up=200,
                manual_spot=600,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert [len(call) for call in client.snapshot_calls] == [400, 1]
    assert result.status == "connected"
    assert result.total_selected_codes == 401
    assert len(result.rows) == 401
    assert result.snapshot_rows_count == 401
    assert result.rate_estimate.requests_per_refresh == 2
    assert result.rate_estimate.requests_per_30_seconds == 60
    assert result.as_dict()["per_symbol"][0]["selected_contracts"] == 401


def test_main_prints_error_json_when_real_client_cannot_be_created(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["--expiry", "2026-04-27"])

    assert exc_info.value.code == 1
    output = capsys.readouterr().out
    assert '"status":"error"' in output
    assert "moomoo-api package is not installed" in output
