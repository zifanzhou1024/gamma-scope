from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Iterable
from datetime import date

import pytest

from gammascope_collector.moomoo_config import MoomooCollectorConfig, MoomooSymbolConfig, SnapshotRateEstimate
from gammascope_collector.moomoo_snapshot import (
    MoomooContract,
    MoomooOptionRow,
    MoomooSnapshotResult,
    MoomooSymbolDiscoveryResult,
    _publish_spx_compatibility_snapshot,
    collect_moomoo_snapshot_once,
    discover_symbol_contracts,
    main,
    normalize_snapshot_record,
    run_moomoo_snapshot_loop,
    select_atm_strikes,
)
from gammascope_collector.publisher import PublishSummary


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

    def get_option_chain(self, code: str, *, start: str, end: str) -> tuple[int, list[dict[str, object]]]:
        self.option_chain_calls.append((code, start, end))
        return 0, self.chains.get(code, [])

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
        self.snapshot_calls.append(list(code_list))
        return 0, [self.snapshots[code] for code in code_list if code in self.snapshots]

    def close(self) -> None:
        self.closed = True


class InterruptingQuoteClient(FakeQuoteClient):
    def __init__(self, *, interrupt_after_snapshots: int, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self.interrupt_after_snapshots = interrupt_after_snapshots

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
        if len(self.snapshot_calls) >= self.interrupt_after_snapshots:
            raise KeyboardInterrupt
        return super().get_market_snapshot(code_list)


class SequencedSnapshotQuoteClient(FakeQuoteClient):
    def __init__(
        self,
        *,
        snapshot_sequences: dict[str, list[dict[str, object]]],
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self.snapshot_sequences = snapshot_sequences
        self.snapshot_indexes: dict[str, int] = {}

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
        self.snapshot_calls.append(list(code_list))
        rows: list[dict[str, object]] = []
        for code in code_list:
            sequence = self.snapshot_sequences.get(code)
            if sequence:
                index = self.snapshot_indexes.get(code, 0)
                rows.append(sequence[min(index, len(sequence) - 1)])
                self.snapshot_indexes[code] = index + 1
            elif code in self.snapshots:
                rows.append(self.snapshots[code])
        return 0, rows


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


def test_discover_symbol_contracts_calls_option_chain_with_keyword_dates() -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY240427C00500000", strike=500, option_type="CALL"),
                _option("US.SPY240427P00500000", strike=500, option_type="PUT"),
            ]
        }
    )
    symbol = MoomooSymbolConfig(
        symbol="SPY",
        owner_code="US.SPY",
        strike_window_down=0,
        strike_window_up=0,
        manual_spot=500,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert [contract.option_code for contract in result.contracts] == [
        "US.SPY240427C00500000",
        "US.SPY240427P00500000",
    ]
    assert client.option_chain_calls == [("US.SPY", "2026-04-27", "2026-04-27")]


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


def test_discover_symbol_contracts_warns_when_option_chain_returns_no_rows() -> None:
    client = FakeQuoteClient(chains={"US.SPY": []})
    symbol = MoomooSymbolConfig(
        symbol="SPY",
        owner_code="US.SPY",
        strike_window_down=0,
        strike_window_up=0,
        manual_spot=500,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert result.contracts == []
    assert result.warnings == ["SPY option chain returned zero rows"]


def test_discover_symbol_contracts_warns_when_chain_has_no_rows_for_target_expiry() -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY240428C00500000", strike=500, option_type="CALL", expiry="2026-04-28"),
            ]
        }
    )
    symbol = MoomooSymbolConfig(
        symbol="SPY",
        owner_code="US.SPY",
        strike_window_down=0,
        strike_window_up=0,
        manual_spot=500,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert result.contracts == []
    assert result.warnings == ["SPY option chain returned zero rows for expiry 2026-04-27"]


def test_discover_symbol_contracts_uses_live_spot_proxy_for_index_options() -> None:
    client = FakeQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07130000", strike=7130, option_type="CALL", name="SPXW 7130C"),
                _option("US.SPXW260427P07130000", strike=7130, option_type="PUT", name="SPXW 7130P"),
                _option("US.SPXW260427C07140000", strike=7140, option_type="CALL", name="SPXW 7140C"),
                _option("US.SPXW260427P07140000", strike=7140, option_type="PUT", name="SPXW 7140P"),
            ]
        },
        snapshots={
            "US.SPY": {
                "code": "US.SPY",
                "last_price": 713.84,
            }
        },
    )
    symbol = MoomooSymbolConfig(
        symbol="SPX",
        owner_code="US..SPX",
        strike_window_down=0,
        strike_window_up=0,
        family_filter="SPXW",
        spot_proxy_code="US.SPY",
        spot_proxy_multiplier=10.0,
    )

    result = discover_symbol_contracts(client, symbol, expiry=date(2026, 4, 27))

    assert client.snapshot_calls == [["US.SPY"]]
    assert result.spot == pytest.approx(7138.4)
    assert [contract.option_code for contract in result.contracts] == [
        "US.SPXW260427C07140000",
        "US.SPXW260427P07140000",
    ]


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


@pytest.mark.parametrize("manual_spot", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_manual_spot_skips_symbol_without_fetching_option_chain(manual_spot: float) -> None:
    client = FakeQuoteClient()
    symbol = MoomooSymbolConfig(
        symbol="SPX",
        owner_code="US.SPX",
        strike_window_down=1,
        strike_window_up=1,
        requires_manual_spot=True,
        manual_spot=manual_spot,
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
            "update_time": "2026-04-27 09:31:05",
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
    assert row.snapshot_time == "2026-04-27 09:31:05"
    assert row.as_dict()["snapshot_time"] == "2026-04-27 09:31:05"


def test_normalize_snapshot_record_maps_documented_moomoo_option_fields() -> None:
    contract = MoomooContract(
        symbol="SPY",
        owner_code="US.SPY",
        option_code="US.SPY240427P00500000",
        option_type="PUT",
        strike=500.0,
        expiry=date(2026, 4, 27),
        name="SPY 500P",
    )

    row = normalize_snapshot_record(
        contract,
        {
            "code": "US.SPY240427P00500000",
            "last_price": 2.5,
            "bid_price": 2.4,
            "ask_price": 2.6,
            "bid_vol": 21,
            "ask_vol": 22,
            "option_open_interest": 300,
            "option_implied_volatility": 31.0,
            "option_delta": -0.48,
            "option_gamma": 0.03,
            "option_vega": 0.16,
            "option_theta": -0.05,
            "option_rho": -0.02,
            "option_contract_multiplier": 100,
        },
    )

    assert row.bid_size == 21.0
    assert row.ask_size == 22.0
    assert row.open_interest == 300.0
    assert row.implied_volatility == 0.31
    assert row.delta == -0.48
    assert row.gamma == 0.03
    assert row.vega == 0.16
    assert row.theta == -0.05
    assert row.rho == -0.02
    assert row.contract_multiplier == 100.0


def test_normalize_snapshot_record_keeps_already_decimal_iv() -> None:
    contract = MoomooContract(
        symbol="SPY",
        owner_code="US.SPY",
        option_code="US.SPY240427P00500000",
        option_type="PUT",
        strike=500.0,
        expiry=date(2026, 4, 27),
        name="SPY 500P",
    )

    row = normalize_snapshot_record(
        contract,
        {
            "code": "US.SPY240427P00500000",
            "option_implied_volatility": 0.22,
        },
    )

    assert row.implied_volatility == 0.22


def test_normalize_snapshot_record_converts_non_finite_and_non_numeric_values_to_none() -> None:
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
            "last_price": float("nan"),
            "bid_price": float("inf"),
            "ask_price": float("-inf"),
            "bid_volume": "not-a-number",
            "ask_volume": float("nan"),
            "volume": float("inf"),
            "open_interest": float("-inf"),
            "implied_volatility": float("nan"),
            "delta": "not-a-number",
            "gamma": float("inf"),
            "vega": float("-inf"),
            "theta": float("nan"),
            "rho": object(),
            "contract_multiplier": float("inf"),
        },
    )

    assert row.last_price is None
    assert row.bid_price is None
    assert row.ask_price is None
    assert row.bid_size is None
    assert row.ask_size is None
    assert row.volume is None
    assert row.open_interest is None
    assert row.implied_volatility is None
    assert row.delta is None
    assert row.gamma is None
    assert row.vega is None
    assert row.theta is None
    assert row.rho is None
    assert row.contract_multiplier is None


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


def test_collect_moomoo_snapshot_once_refreshes_live_spx_spot_proxy() -> None:
    client = SequencedSnapshotQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07130000", strike=7130, option_type="CALL", name="SPXW 7130C"),
                _option("US.SPXW260427P07130000", strike=7130, option_type="PUT", name="SPXW 7130P"),
            ]
        },
        snapshots={
            "US.SPXW260427C07130000": {"code": "US.SPXW260427C07130000", "bid_price": 12.0, "ask_price": 12.5},
            "US.SPXW260427P07130000": {"code": "US.SPXW260427P07130000", "bid_price": 11.5, "ask_price": 12.0},
        },
        snapshot_sequences={
            "US.SPY": [
                {"code": "US.SPY", "last_price": 713.0},
                {"code": "US.SPY", "last_price": 714.25},
            ]
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=2,
        universe=[
            MoomooSymbolConfig(
                symbol="SPX",
                owner_code="US..SPX",
                strike_window_down=0,
                strike_window_up=0,
                family_filter="SPXW",
                spot_proxy_code="US.SPY",
                spot_proxy_multiplier=10.0,
                publish_to_spx_dashboard=True,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert client.snapshot_calls == [
        ["US.SPY"],
        ["US.SPY"],
        ["US.SPXW260427C07130000", "US.SPXW260427P07130000"],
    ]
    assert result.discoveries[0].spot == pytest.approx(7142.5)
    assert result.rate_estimate.extra_requests_per_refresh == 1
    assert result.rate_estimate.requests_per_refresh == 2


def test_collect_moomoo_snapshot_once_prefers_option_implied_spx_spot_over_proxy() -> None:
    client = SequencedSnapshotQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07130000", strike=7130, option_type="CALL", name="SPXW 7130C"),
                _option("US.SPXW260427P07130000", strike=7130, option_type="PUT", name="SPXW 7130P"),
                _option("US.SPXW260427C07140000", strike=7140, option_type="CALL", name="SPXW 7140C"),
                _option("US.SPXW260427P07140000", strike=7140, option_type="PUT", name="SPXW 7140P"),
                _option("US.SPXW260427C07150000", strike=7150, option_type="CALL", name="SPXW 7150C"),
                _option("US.SPXW260427P07150000", strike=7150, option_type="PUT", name="SPXW 7150P"),
            ]
        },
        snapshots={
            "US.SPXW260427C07130000": {"code": "US.SPXW260427C07130000", "bid_price": 15.7, "ask_price": 16.3},
            "US.SPXW260427P07130000": {"code": "US.SPXW260427P07130000", "bid_price": 5.7, "ask_price": 6.3},
            "US.SPXW260427C07140000": {"code": "US.SPXW260427C07140000", "bid_price": 10.7, "ask_price": 11.3},
            "US.SPXW260427P07140000": {"code": "US.SPXW260427P07140000", "bid_price": 10.7, "ask_price": 11.3},
            "US.SPXW260427C07150000": {"code": "US.SPXW260427C07150000", "bid_price": 5.7, "ask_price": 6.3},
            "US.SPXW260427P07150000": {"code": "US.SPXW260427P07150000", "bid_price": 15.7, "ask_price": 16.3},
        },
        snapshot_sequences={
            "US.SPY": [
                {"code": "US.SPY", "last_price": 711.0},
                {"code": "US.SPY", "last_price": 711.2},
            ]
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=2,
        universe=[
            MoomooSymbolConfig(
                symbol="SPX",
                owner_code="US..SPX",
                strike_window_down=1,
                strike_window_up=1,
                family_filter="SPXW",
                spot_proxy_code="US.SPY",
                spot_proxy_multiplier=10.035,
                infer_spot_from_options=True,
                publish_to_spx_dashboard=True,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert result.discoveries[0].spot == pytest.approx(7140.0)


def test_run_moomoo_snapshot_loop_discovers_once_and_snapshots_each_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY240427C00500000", strike=500, option_type="CALL"),
                _option("US.SPY240427P00500000", strike=500, option_type="PUT"),
            ]
        },
        snapshots={
            "US.SPY240427C00500000": {"code": "US.SPY240427C00500000", "last_price": 1.0},
            "US.SPY240427P00500000": {"code": "US.SPY240427P00500000", "last_price": 1.1},
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=1,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ],
    )
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.sleep", lambda seconds: None)

    result = run_moomoo_snapshot_loop(client, config, expiry=date(2026, 4, 27), max_loops=2)

    assert len(client.option_chain_calls) == 1
    assert len(client.snapshot_calls) == 2
    assert result.snapshot_rows_count == 2


def test_run_moomoo_snapshot_loop_sleeps_only_remaining_interval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY240427C00500000", strike=500, option_type="CALL"),
            ]
        },
        snapshots={
            "US.SPY240427C00500000": {"code": "US.SPY240427C00500000", "last_price": 1.0},
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=1,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ],
    )
    clock_values = iter([10.0, 10.25, 11.0, 11.25])
    sleeps: list[float] = []
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.perf_counter", lambda: next(clock_values))
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.sleep", sleeps.append)

    run_moomoo_snapshot_loop(client, config, expiry=date(2026, 4, 27), max_loops=2)

    assert sleeps == [0.75]


def test_main_prints_error_json_when_client_factory_cannot_create_client(capsys: pytest.CaptureFixture[str]) -> None:
    def fail_client_factory(_host: str, _port: int) -> FakeQuoteClient:
        raise RuntimeError("client factory unavailable")

    with pytest.raises(SystemExit) as exc_info:
        main(["--expiry", "2026-04-27"], client_factory=fail_client_factory)

    assert exc_info.value.code == 1
    output = capsys.readouterr().out
    assert '"status":"error"' in output
    assert "client factory unavailable" in output


def test_collect_moomoo_snapshot_once_degrades_when_snapshot_returns_fewer_known_codes() -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY240427C00500000", strike=500, option_type="CALL"),
                _option("US.SPY240427P00500000", strike=500, option_type="PUT"),
            ]
        },
        snapshots={
            "US.SPY240427C00500000": {"code": "US.SPY240427C00500000", "last_price": 1.0},
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=2,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert result.status == "degraded"
    assert result.snapshot_rows_count == 1
    assert result.warnings == ["Snapshot row count mismatch: expected 2, returned 1, missing 1"]


def test_collect_moomoo_snapshot_once_degrades_when_snapshot_returns_duplicate_known_codes() -> None:
    class DuplicateSnapshotClient(FakeQuoteClient):
        def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
            self.snapshot_calls.append(list(code_list))
            rows = [self.snapshots[code] for code in code_list if code in self.snapshots]
            return 0, rows + [rows[0]]

    client = DuplicateSnapshotClient(
        chains={
            "US.SPY": [
                _option("US.SPY240427C00500000", strike=500, option_type="CALL"),
                _option("US.SPY240427P00500000", strike=500, option_type="PUT"),
            ]
        },
        snapshots={
            "US.SPY240427C00500000": {"code": "US.SPY240427C00500000", "last_price": 1.0},
            "US.SPY240427P00500000": {"code": "US.SPY240427P00500000", "last_price": 1.1},
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=2,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert result.status == "degraded"
    assert result.snapshot_rows_count == 2
    assert result.warnings == ["Snapshot row count mismatch: expected 2, returned 3, duplicates 1"]


def test_collect_moomoo_snapshot_once_skips_snapshot_polling_when_rate_preflight_is_unsafe() -> None:
    contracts = [
        _option(f"US.SPY240427C{i:05d}", strike=200 + i, option_type="CALL", name=f"SPY {200 + i}C")
        for i in range(801)
    ]
    client = FakeQuoteClient(chains={"US.SPY": contracts})
    config = MoomooCollectorConfig(
        refresh_interval_seconds=1,
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=400,
                strike_window_up=400,
                manual_spot=600,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert client.snapshot_calls == []
    assert result.status == "degraded"
    assert result.snapshot_rows_count == 0
    assert result.total_selected_codes == 801
    assert result.warnings == ["Snapshot preflight exceeds limit: 90 requests per 30 seconds"]


def test_run_moomoo_snapshot_loop_invokes_callback_for_each_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07050000", strike=7050, option_type="CALL", name="SPXW 7050C"),
                _option("US.SPXW260427P07050000", strike=7050, option_type="PUT", name="SPXW 7050P"),
            ]
        },
        snapshots={
            "US.SPXW260427C07050000": {"code": "US.SPXW260427C07050000", "bid_price": 1.1, "ask_price": 1.3},
            "US.SPXW260427P07050000": {"code": "US.SPXW260427P07050000", "bid_price": 1.2, "ask_price": 1.6},
        },
    )
    results: list[MoomooSnapshotResult] = []
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.sleep", lambda _seconds: None)

    final_result = run_moomoo_snapshot_loop(
        client,
        MoomooCollectorConfig(
            refresh_interval_seconds=1,
            manual_spots={"SPX": 7050},
            universe=[
                MoomooSymbolConfig(
                    symbol="SPX",
                    owner_code="US..SPX",
                    strike_window_down=0,
                    strike_window_up=0,
                    family_filter="SPXW",
                    requires_manual_spot=True,
                    publish_to_spx_dashboard=True,
                )
            ],
        ),
        expiry=date(2026, 4, 27),
        max_loops=2,
        on_result=results.append,
    )

    assert len(results) == 2
    assert results[-1] is final_result
    assert len(client.snapshot_calls) == 2


def test_main_help_describes_moomoo_0dte_snapshot(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        main(["--help"])

    assert exc_info.value.code == 0
    output = capsys.readouterr().out
    assert "Collect Moomoo 0DTE option snapshots" in output


def test_module_cli_help_accepts_pnpm_forwarded_separator() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "gammascope_collector.moomoo_snapshot", "--", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "Collect Moomoo 0DTE option snapshots" in result.stdout


def test_main_publish_mode_publishes_moomoo_spx_compatibility_events(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = FakeQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07050000", strike=7050, option_type="CALL", name="SPXW 7050C"),
                _option("US.SPXW260427P07050000", strike=7050, option_type="PUT", name="SPXW 7050P"),
            ]
        },
        snapshots={
            "US.SPXW260427C07050000": {
                "code": "US.SPXW260427C07050000",
                "last_price": 1.2,
                "bid_price": 1.1,
                "ask_price": 1.3,
            },
            "US.SPXW260427P07050000": {
                "code": "US.SPXW260427P07050000",
                "last_price": 1.4,
                "bid_price": 1.2,
                "ask_price": 1.6,
            },
        },
    )
    captured_events: list[dict[str, object]] = []

    def fake_publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=[
                "CollectorHealth"
                if "collector_id" in event
                else "ContractDiscovered"
                if "ibkr_con_id" in event
                else "UnderlyingTick"
                if "spot" in event
                else "OptionTick"
                for event in captured_events
            ],
        )

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)

    main(
        [
            "--publish",
            "--api",
            "http://testserver",
            "--collector-id",
            "test-moomoo",
            "--expiry",
            "2026-04-27",
            "--spot",
            "SPX=7050",
            "--max-loops",
            "1",
        ],
        client_factory=lambda _host, _port: client,
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["publish"]["accepted_count"] == 6
    assert payload["publish"]["event_types"] == [
        "CollectorHealth",
        "UnderlyingTick",
        "ContractDiscovered",
        "ContractDiscovered",
        "OptionTick",
        "OptionTick",
    ]
    assert len(captured_events) == 6


def test_main_max_loops_zero_runs_until_interrupted_and_publishes_each_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = InterruptingQuoteClient(
        interrupt_after_snapshots=5,
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07050000", strike=7050, option_type="CALL", name="SPXW 7050C"),
                _option("US.SPXW260427P07050000", strike=7050, option_type="PUT", name="SPXW 7050P"),
            ]
        },
        snapshots={
            "US.SPY": {"code": "US.SPY", "last_price": 705.0},
            "US.SPXW260427C07050000": {"code": "US.SPXW260427C07050000", "bid_price": 1.1, "ask_price": 1.3},
            "US.SPXW260427P07050000": {"code": "US.SPXW260427P07050000", "bid_price": 1.2, "ask_price": 1.6},
        },
    )
    captured_batches: list[list[dict[str, object]]] = []

    def fake_publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        batch = list(events)
        captured_batches.append(batch)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(batch),
            event_types=["CollectorHealth" if "collector_id" in event else "Other" for event in batch],
        )

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.sleep", lambda _seconds: None)

    with pytest.raises(KeyboardInterrupt):
        main(
            [
                "--publish",
                "--api",
                "http://testserver",
                "--collector-id",
                "test-moomoo",
                "--expiry",
                "2026-04-27",
                "--spot",
                "SPX=7050",
                "--spot",
                "SPY=500",
                "--spot",
                "QQQ=450",
                "--spot",
                "IWM=200",
                "--spot",
                "RUT=2050",
                "--spot",
                "NDX=18300",
                "--interval-seconds",
                "1",
                "--max-loops",
                "0",
            ],
            client_factory=lambda _host, _port: client,
        )

    assert len(captured_batches) == 2
    assert all(len(batch) == 6 for batch in captured_batches)
    assert client.closed is True


def test_main_publish_mode_publishes_each_snapshot_loop(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = FakeQuoteClient(
        chains={
            "US..SPX": [
                _option("US.SPXW260427C07050000", strike=7050, option_type="CALL", name="SPXW 7050C"),
                _option("US.SPXW260427P07050000", strike=7050, option_type="PUT", name="SPXW 7050P"),
            ]
        },
        snapshots={
            "US.SPXW260427C07050000": {"code": "US.SPXW260427C07050000", "bid_price": 1.1, "ask_price": 1.3},
            "US.SPXW260427P07050000": {"code": "US.SPXW260427P07050000", "bid_price": 1.2, "ask_price": 1.6},
        },
    )
    captured_batches: list[list[dict[str, object]]] = []

    def fake_publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        batch = list(events)
        captured_batches.append(batch)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(batch),
            event_types=[
                "CollectorHealth"
                if "collector_id" in event
                else "ContractDiscovered"
                if "ibkr_con_id" in event
                else "UnderlyingTick"
                if "spot" in event
                else "OptionTick"
                for event in batch
            ],
        )

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)
    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.time.sleep", lambda _seconds: None)

    main(
        [
            "--publish",
            "--api",
            "http://testserver",
            "--collector-id",
            "test-moomoo",
            "--expiry",
            "2026-04-27",
            "--spot",
            "SPX=7050",
            "--interval-seconds",
            "1",
            "--max-loops",
            "2",
        ],
        client_factory=lambda _host, _port: client,
    )

    payload = json.loads(capsys.readouterr().out)
    assert len(captured_batches) == 2
    assert all(len(batch) == 6 for batch in captured_batches)
    assert payload["publish"]["accepted_count"] == 6


def test_main_publish_mode_publishes_degraded_health_only_when_no_spx_rows(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY260427C00500000", strike=500, option_type="CALL", name="SPY 500C"),
            ]
        },
        snapshots={
            "US.SPY260427C00500000": {
                "code": "US.SPY260427C00500000",
                "last_price": 1.2,
                "bid_price": 1.1,
                "ask_price": 1.3,
            },
        },
    )
    captured_events: list[dict[str, object]] = []

    def fake_publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=["CollectorHealth" if "collector_id" in event else "Unexpected" for event in captured_events],
        )

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)

    main(
        [
            "--publish",
            "--api",
            "http://testserver",
            "--collector-id",
            "test-moomoo",
            "--expiry",
            "2026-04-27",
            "--spot",
            "SPY=500",
            "--max-loops",
            "1",
        ],
        client_factory=lambda _host, _port: client,
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "connected"
    assert payload["publish"]["accepted_count"] == 1
    assert payload["publish"]["event_types"] == ["CollectorHealth"]
    assert len(captured_events) == 1
    assert captured_events[0]["status"] == "degraded"


def test_publish_spx_compatibility_snapshot_degrades_health_for_non_finite_spx_spot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_events: list[dict[str, object]] = []

    def fake_publish(events: Iterable[dict[str, object]], *, api_base: str) -> PublishSummary:
        captured_events.extend(events)
        return PublishSummary(
            endpoint=f"{api_base}/api/spx/0dte/collector/events",
            accepted_count=len(captured_events),
            event_types=["CollectorHealth" if "collector_id" in event else "Unexpected" for event in captured_events],
        )

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)
    result = MoomooSnapshotResult(
        status="connected",
        subscription={},
        discoveries=[
            MoomooSymbolDiscoveryResult(
                symbol="SPX",
                owner_code="US..SPX",
                spot=float("nan"),
                contracts=[],
                warnings=[],
            )
        ],
        rows=[
            MoomooOptionRow(
                symbol="SPX",
                owner_code="US..SPX",
                option_code="US.SPXW260427C07050000",
                option_type="CALL",
                strike=7050,
                expiry=date(2026, 4, 27),
                name="SPXW 7050C",
                bid_price=1.1,
                ask_price=1.3,
            )
        ],
        total_selected_codes=1,
        rate_estimate=SnapshotRateEstimate(codes=1, requests_per_refresh=1, requests_per_30_seconds=15, within_limit=True),
        warnings=[],
    )

    _publish_spx_compatibility_snapshot(result, MoomooCollectorConfig(api_base="http://testserver"))

    assert len(captured_events) == 1
    assert captured_events[0]["status"] == "degraded"
