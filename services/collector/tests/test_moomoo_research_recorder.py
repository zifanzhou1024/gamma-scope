from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from gammascope_collector.moomoo_config import MoomooCollectorConfig, MoomooSymbolConfig
from gammascope_collector.moomoo_research_recorder import (
    capture_research_snapshot_once,
    next_regular_session_window,
    run_market_hours_recorder_loop,
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
        self.snapshot_calls: list[list[str]] = []
        self.option_chain_calls: list[tuple[str, str, str]] = []

    def query_subscription(self, is_all_conn: bool = True) -> tuple[int, dict[str, object]]:
        return 0, {"is_all_conn": is_all_conn, "sub_list": ["US.SPY"]}

    def get_option_chain(self, code: str, *, start: str, end: str) -> tuple[int, list[dict[str, object]]]:
        self.option_chain_calls.append((code, start, end))
        return 0, self.chains.get(code, [])

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, object]]]:
        self.snapshot_calls.append(list(code_list))
        return 0, [self.snapshots[code] for code in code_list if code in self.snapshots]

    def close(self) -> None:
        return None


def test_capture_research_snapshot_once_writes_full_raw_option_fields(tmp_path: Path) -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY260518C00500000", strike=500, option_type="CALL"),
                _option("US.SPY260518P00500000", strike=500, option_type="PUT"),
            ]
        },
        snapshots={
            "US.SPY": {
                "code": "US.SPY",
                "last_price": 500.0,
                "sec_status": "NORMAL",
            },
            "US.SPY260518C00500000": {
                "code": "US.SPY260518C00500000",
                "name": "SPY 500C",
                "last_price": 1.25,
                "bid_price": 1.2,
                "ask_price": 1.3,
                "bid_vol": 11,
                "ask_vol": 12,
                "volume": 100,
                "option_open_interest": 200,
                "option_implied_volatility": 30.0,
                "option_delta": 0.51,
                "option_gamma": 0.02,
                "option_vega": 0.15,
                "option_theta": -0.04,
                "option_rho": 0.03,
                "option_premium": 125.0,
                "option_net_open_interest": 7,
                "provider_extra_field": "keep-me",
                "update_time": "2026-05-18 09:31:00",
            },
            "US.SPY260518P00500000": {
                "code": "US.SPY260518P00500000",
                "name": "SPY 500P",
                "last_price": 1.35,
                "bid_price": 1.3,
                "ask_price": 1.4,
                "option_open_interest": 220,
                "update_time": "2026-05-18 09:31:00",
            },
        },
    )
    config = MoomooCollectorConfig(
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ]
    )

    summary = capture_research_snapshot_once(
        client,
        config,
        output_dir=tmp_path,
        expiry=date(2026, 5, 18),
        timeline_seconds=10,
    )

    assert summary.option_rows_written == 2
    assert summary.batch_rows_written == 1
    assert summary.underlying_rows_written == 1
    assert summary.selected_contracts == {"SPY": 2}
    assert summary.option_files == [str(tmp_path / "moomoo/options/date=2026-05-18/ticker=SPY/records.jsonl")]
    assert summary.batch_files == [str(tmp_path / "moomoo/batches/date=2026-05-18/ticker=SPY/records.jsonl")]

    option_records = _read_jsonl(Path(summary.option_files[0]))
    assert option_records[0]["source"] == "moomoo"
    assert option_records[0]["record_type"] == "option_snapshot"
    assert option_records[0]["ticker"] == "SPY"
    assert option_records[0]["symbol"] == "SPY"
    assert option_records[0]["time_utc"] == option_records[0]["captured_at_utc"]
    assert option_records[0]["time_bucket_utc"] == option_records[0]["timeline_bucket_utc"]
    assert option_records[0]["timeline_bucket_utc"].endswith("Z")
    assert option_records[0]["timeline_seconds"] == 10
    assert option_records[0]["raw"]["provider_extra_field"] == "keep-me"
    assert option_records[0]["raw"]["option_net_open_interest"] == 7
    assert option_records[0]["raw"]["option_premium"] == 125.0
    assert option_records[0]["normalized"]["implied_volatility"] == 0.3
    assert option_records[0]["normalized"]["rho"] == 0.03

    underlying_records = _read_jsonl(Path(summary.underlying_files[0]))
    assert underlying_records[0]["record_type"] == "underlying_snapshot"
    assert underlying_records[0]["ticker"] == "SPY"
    assert underlying_records[0]["symbol"] == "SPY"
    assert underlying_records[0]["provider_code"] == "US.SPY"
    assert underlying_records[0]["time_utc"] == underlying_records[0]["captured_at_utc"]
    assert underlying_records[0]["timeline_seconds"] == 10
    assert underlying_records[0]["raw"]["sec_status"] == "NORMAL"

    batch_records = _read_jsonl(Path(summary.batch_files[0]))
    assert batch_records[0]["record_type"] == "option_snapshot_batch"
    assert batch_records[0]["ticker"] == "SPY"
    assert batch_records[0]["symbol"] == "SPY"
    assert batch_records[0]["time_utc"] == batch_records[0]["captured_at_utc"]
    assert batch_records[0]["time_bucket_utc"] == batch_records[0]["timeline_bucket_utc"]
    assert batch_records[0]["contract_count"] == 2
    assert batch_records[0]["contracts"][0]["option_code"] == "US.SPY260518C00500000"
    assert batch_records[0]["contracts"][0]["raw"]["provider_extra_field"] == "keep-me"
    assert batch_records[0]["contracts"][0]["raw"]["option_net_open_interest"] == 7
    assert batch_records[0]["contracts"][0]["normalized"]["implied_volatility"] == 0.3

    capture_records = _read_jsonl(tmp_path / "moomoo/captures/date=2026-05-18/captures.jsonl")
    assert capture_records[0]["time_utc"] == capture_records[0]["captured_at_utc"]
    assert capture_records[0]["time_bucket_utc"] == capture_records[0]["timeline_bucket_utc"]
    assert capture_records[0]["option_rows_written"] == 2
    assert capture_records[0]["batch_rows_written"] == 1
    assert capture_records[0]["underlying_rows_written"] == 1
    assert capture_records[0]["tickers"] == ["SPY"]


def test_capture_research_snapshot_once_records_missing_manual_spot_warning(tmp_path: Path) -> None:
    client = FakeQuoteClient()
    config = MoomooCollectorConfig(
        universe=[
            MoomooSymbolConfig(
                symbol="RUT",
                owner_code="US..RUT",
                strike_window_down=1,
                strike_window_up=1,
                requires_manual_spot=True,
            )
        ]
    )

    summary = capture_research_snapshot_once(
        client,
        config,
        output_dir=tmp_path,
        expiry=date(2026, 5, 18),
        timeline_seconds=10,
    )

    assert summary.option_rows_written == 0
    assert summary.selected_contracts == {"RUT": 0}
    assert summary.warnings == ["RUT requires manual spot and none was supplied"]
    assert client.option_chain_calls == []


def test_next_regular_session_window_uses_regular_eastern_market_hours() -> None:
    eastern = ZoneInfo("America/New_York")

    session = next_regular_session_window(datetime(2026, 5, 18, 9, 29, tzinfo=eastern))

    assert session.market_date == "2026-05-18"
    assert session.opens_at_utc == "2026-05-18T13:30:00Z"
    assert session.closes_at_utc == "2026-05-18T20:00:00Z"


def test_next_regular_session_window_rolls_after_close_and_skips_weekends() -> None:
    eastern = ZoneInfo("America/New_York")

    monday = next_regular_session_window(datetime(2026, 5, 15, 16, 1, tzinfo=eastern))

    assert monday.market_date == "2026-05-18"
    assert monday.opens_at_utc == "2026-05-18T13:30:00Z"


def test_market_hours_loop_captures_when_inside_regular_session(tmp_path: Path) -> None:
    client = FakeQuoteClient(
        chains={
            "US.SPY": [
                _option("US.SPY260518C00500000", strike=500, option_type="CALL"),
                _option("US.SPY260518P00500000", strike=500, option_type="PUT"),
            ]
        },
        snapshots={
            "US.SPY": {"code": "US.SPY", "last_price": 500.0},
            "US.SPY260518C00500000": {"code": "US.SPY260518C00500000", "last_price": 1.25},
            "US.SPY260518P00500000": {"code": "US.SPY260518P00500000", "last_price": 1.35},
        },
    )
    config = MoomooCollectorConfig(
        universe=[
            MoomooSymbolConfig(
                symbol="SPY",
                owner_code="US.SPY",
                strike_window_down=0,
                strike_window_up=0,
                manual_spot=500,
            )
        ]
    )

    summary = run_market_hours_recorder_loop(
        client,
        config,
        output_dir=tmp_path,
        expiry=date(2026, 5, 18),
        max_loops=1,
        now_provider=lambda: datetime(2026, 5, 18, 13, 31, tzinfo=UTC),
        sleep=lambda _: None,
    )

    assert summary.option_rows_written == 2
    assert Path(summary.option_files[0]).exists()


def _option(code: str, *, strike: float, option_type: str) -> dict[str, object]:
    return {
        "code": code,
        "name": code,
        "strike_price": strike,
        "option_type": option_type,
        "strike_time": "2026-05-18",
    }


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
