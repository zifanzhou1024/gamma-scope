# Moomoo Data Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Moomoo snapshot collector that fetches the configured six-symbol 0DTE universe every 2 seconds, publishes only SPX through the existing collector event contract, and adds a browser-local dashboard source selector that defaults to Moomoo.

**Architecture:** Keep the existing API and analytics contracts SPX/IBKR-shaped for this compatibility phase. Add focused Moomoo collector modules for config, snapshot discovery/polling, and SPX compatibility event translation. The web selector is display/preference-only and does not control collector processes.

**Tech Stack:** Python 3.11+, pytest, lazy `moomoo-api` import, pandas-compatible row handling, existing GammaScope collector events/publisher, Next.js React 19, TypeScript, Vitest.

---

Spec: `docs/superpowers/specs/2026-04-27-moomoo-data-source-design.md`

## Scope Check

This plan intentionally covers two coupled outputs from the approved spec:

- Collector side: Moomoo universe discovery, snapshot polling, SPX compatibility event translation, CLI, docs, and package script.
- Web side: a browser-local source selector that defaults to Moomoo and labels the current dashboard source preference.

The plan does not generalize collector schemas, does not add a multi-symbol dashboard, and does not add web process controls.

## File Structure

- Create `services/collector/gammascope_collector/moomoo_config.py`
  - Owns Moomoo host/port defaults, universe entries, manual spot parsing, selected-symbol filtering, chunking, and rate-limit math.
- Create `services/collector/gammascope_collector/moomoo_snapshot.py`
  - Owns quote-client protocol, lazy real Moomoo client, chain discovery, snapshot polling, row normalization, runtime loop, CLI, and JSON result output.
- Create `services/collector/gammascope_collector/moomoo_compat.py`
  - Owns deterministic synthetic `ibkr_con_id` generation and translation from normalized SPX Moomoo rows into current collector events.
- Create `services/collector/tests/test_moomoo_config.py`
  - Covers pure config, manual spot parsing, default universe, chunks, and rate preflight.
- Create `services/collector/tests/test_moomoo_snapshot.py`
  - Covers fake quote-client discovery, family fallback, missing manual spot skip, snapshot chunking, row normalization, loop limits, and CLI output.
- Create `services/collector/tests/test_moomoo_compat.py`
  - Covers SPX-only event translation and generated collector schema validation.
- Modify `package.json`
  - Add `collector:moomoo-snapshot`.
- Modify `README.md`
  - Add local Moomoo OpenD setup, manual spot examples, 2-second snapshot polling, and publish command.
- Create `apps/web/lib/sourcePreference.ts`
  - Owns source preference type, default source, validation, localStorage load/save helpers.
- Create `apps/web/components/SourceSelector.tsx`
  - Owns compact source selector control.
- Modify `apps/web/components/LiveDashboard.tsx`
  - Owns browser-local source preference state and passes it to the dashboard view.
- Modify `apps/web/components/DashboardView.tsx`
  - Renders the source selector and source label in the top bar.
- Modify `apps/web/app/styles.css`
  - Adds source selector styles.
- Create `apps/web/tests/sourcePreference.test.ts`
  - Covers default, validation, load, and save behavior.
- Create `apps/web/tests/SourceSelector.test.tsx`
  - Covers rendered options and selected-state markup.
- Modify `apps/web/tests/LiveDashboard.test.tsx`
  - Covers default Moomoo source label in dashboard markup.

## Task 1: Moomoo Config And Pure Helpers

**Files:**

- Create: `services/collector/gammascope_collector/moomoo_config.py`
- Create: `services/collector/tests/test_moomoo_config.py`

- [ ] **Step 1: Write failing tests for config defaults, manual spots, chunking, and rate math**

Create `services/collector/tests/test_moomoo_config.py`:

```python
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
    assert [item.symbol for item in universe if item.requires_manual_spot] == ["SPX", "RUT", "NDX"]


def test_manual_spots_parse_symbol_value_pairs() -> None:
    assert parse_manual_spots(["SPX=7050.25", "rut=2050", " NDX = 18300.5 "]) == {
        "SPX": 7050.25,
        "RUT": 2050.0,
        "NDX": 18300.5,
    }


@pytest.mark.parametrize("value", ["SPX", "SPX=", "=7050", "SPX=abc", "SPX=-1", "SPX=0"])
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


def test_snapshot_rate_math_rejects_zero_interval() -> None:
    with pytest.raises(ValueError):
        estimate_snapshot_request_rate(code_count=1, refresh_interval_seconds=0)
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'gammascope_collector.moomoo_config'`.

- [ ] **Step 3: Implement config module**

Create `services/collector/gammascope_collector/moomoo_config.py`:

```python
from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field, replace
from math import ceil

DEFAULT_MOOMOO_HOST = "127.0.0.1"
DEFAULT_MOOMOO_PORT = 11111
DEFAULT_REFRESH_INTERVAL_SECONDS = 2.0
SNAPSHOT_CODE_LIMIT = 400
SNAPSHOT_REQUEST_LIMIT_PER_30_SECONDS = 60


@dataclass(frozen=True)
class MoomooSymbolConfig:
    symbol: str
    owner_code: str
    strike_window_down: int
    strike_window_up: int
    enabled: bool = True
    publish_to_spx_dashboard: bool = False
    family_filter: str | None = None
    requires_manual_spot: bool = False
    manual_spot: float | None = None
    priority: int = 100

    @property
    def strike_count(self) -> int:
        return self.strike_window_down + 1 + self.strike_window_up

    @property
    def contract_count(self) -> int:
        return self.strike_count * 2

    def with_manual_spot(self, spot: float | None) -> MoomooSymbolConfig:
        return replace(self, manual_spot=spot)


@dataclass(frozen=True)
class SnapshotRateEstimate:
    codes: int
    requests_per_refresh: int
    requests_per_30_seconds: int
    within_limit: bool


@dataclass(frozen=True)
class MoomooCollectorConfig:
    host: str = DEFAULT_MOOMOO_HOST
    port: int = DEFAULT_MOOMOO_PORT
    refresh_interval_seconds: float = DEFAULT_REFRESH_INTERVAL_SECONDS
    collector_id: str = "local-moomoo"
    api_base: str = "http://127.0.0.1:8000"
    manual_spots: dict[str, float] = field(default_factory=dict)
    universe: Sequence[MoomooSymbolConfig] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.refresh_interval_seconds <= 0:
            raise ValueError("refresh_interval_seconds must be greater than zero")
        if not self.universe:
            object.__setattr__(self, "universe", tuple(default_moomoo_universe()))


def default_moomoo_universe() -> list[MoomooSymbolConfig]:
    return [
        MoomooSymbolConfig(
            symbol="SPX",
            owner_code="US..SPX",
            strike_window_down=30,
            strike_window_up=30,
            publish_to_spx_dashboard=True,
            family_filter="SPXW",
            requires_manual_spot=True,
            priority=10,
        ),
        MoomooSymbolConfig(
            symbol="SPY",
            owner_code="US.SPY",
            strike_window_down=15,
            strike_window_up=15,
            priority=30,
        ),
        MoomooSymbolConfig(
            symbol="QQQ",
            owner_code="US.QQQ",
            strike_window_down=15,
            strike_window_up=15,
            priority=30,
        ),
        MoomooSymbolConfig(
            symbol="IWM",
            owner_code="US.IWM",
            strike_window_down=10,
            strike_window_up=10,
            priority=40,
        ),
        MoomooSymbolConfig(
            symbol="RUT",
            owner_code="US..RUT",
            strike_window_down=20,
            strike_window_up=20,
            family_filter="RUTW",
            requires_manual_spot=True,
            priority=50,
        ),
        MoomooSymbolConfig(
            symbol="NDX",
            owner_code="US..NDX",
            strike_window_down=50,
            strike_window_up=50,
            family_filter="NDXP",
            requires_manual_spot=True,
            priority=60,
        ),
    ]


def parse_manual_spots(values: Iterable[str]) -> dict[str, float]:
    spots: dict[str, float] = {}
    for raw_value in values:
        if "=" not in raw_value:
            raise ValueError(f"Manual spot must use SYMBOL=VALUE format: {raw_value}")
        raw_symbol, raw_spot = raw_value.split("=", 1)
        symbol = raw_symbol.strip().upper()
        if not symbol:
            raise ValueError("Manual spot symbol must be non-empty")
        try:
            spot = float(raw_spot.strip())
        except ValueError as exc:
            raise ValueError(f"Manual spot for {symbol} must be numeric") from exc
        if spot <= 0:
            raise ValueError(f"Manual spot for {symbol} must be greater than zero")
        spots[symbol] = spot
    return spots


def selected_symbols(config: MoomooCollectorConfig) -> list[MoomooSymbolConfig]:
    selected: list[MoomooSymbolConfig] = []
    for item in config.universe:
        if not item.enabled:
            continue
        selected.append(item.with_manual_spot(config.manual_spots.get(item.symbol.upper(), item.manual_spot)))
    return selected


def chunked(items: Sequence[str], size: int) -> Iterator[list[str]]:
    if size <= 0:
        raise ValueError("chunk size must be greater than zero")
    for index in range(0, len(items), size):
        yield list(items[index : index + size])


def estimate_snapshot_request_rate(
    *,
    code_count: int,
    refresh_interval_seconds: float,
    code_limit: int = SNAPSHOT_CODE_LIMIT,
    request_limit_per_30_seconds: int = SNAPSHOT_REQUEST_LIMIT_PER_30_SECONDS,
) -> SnapshotRateEstimate:
    if refresh_interval_seconds <= 0:
        raise ValueError("refresh_interval_seconds must be greater than zero")
    requests_per_refresh = ceil(code_count / code_limit) if code_count > 0 else 0
    requests_per_30_seconds = ceil(requests_per_refresh * (30 / refresh_interval_seconds))
    return SnapshotRateEstimate(
        codes=code_count,
        requests_per_refresh=requests_per_refresh,
        requests_per_30_seconds=requests_per_30_seconds,
        within_limit=requests_per_30_seconds <= request_limit_per_30_seconds,
    )
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py -q
```

Expected: pass with `7 passed`.

- [ ] **Step 5: Commit config helpers**

Run:

```bash
git add services/collector/gammascope_collector/moomoo_config.py services/collector/tests/test_moomoo_config.py
git commit -m "feat: add moomoo collector config"
```

## Task 2: Moomoo Discovery, Normalization, And Snapshot Polling

**Files:**

- Create: `services/collector/gammascope_collector/moomoo_snapshot.py`
- Create: `services/collector/tests/test_moomoo_snapshot.py`
- Modify: `services/collector/gammascope_collector/moomoo_config.py`

- [ ] **Step 1: Write failing tests for discovery, fallback, normalization, and one snapshot cycle**

Create `services/collector/tests/test_moomoo_snapshot.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pytest

from gammascope_collector.moomoo_config import MoomooCollectorConfig, MoomooSymbolConfig
from gammascope_collector.moomoo_snapshot import (
    MoomooContract,
    MoomooOptionRow,
    collect_moomoo_snapshot_once,
    discover_symbol_contracts,
    main,
    normalize_snapshot_record,
    select_atm_strikes,
)


@dataclass
class FakeMoomooQuoteClient:
    chains: dict[str, list[dict[str, Any]]]
    snapshots: dict[str, dict[str, Any]]
    subscriptions: dict[str, Any] = field(default_factory=lambda: {"total_used": 0, "own_used": 0, "remain": 1000})
    chain_calls: list[tuple[str, str, str]] = field(default_factory=list)
    snapshot_calls: list[list[str]] = field(default_factory=list)
    closed: bool = False

    def query_subscription(self, is_all_conn: bool = True) -> tuple[int, dict[str, Any]]:
        return 0, self.subscriptions

    def get_option_chain(self, code: str, start: str, end: str) -> tuple[int, list[dict[str, Any]]]:
        self.chain_calls.append((code, start, end))
        return 0, list(self.chains.get(code, []))

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, list[dict[str, Any]]]:
        self.snapshot_calls.append(list(code_list))
        return 0, [self.snapshots[code] for code in code_list if code in self.snapshots]

    def close(self) -> None:
        self.closed = True


def chain_row(
    code: str,
    name: str,
    strike: float,
    option_type: str,
    expiry: str = "2026-04-27",
) -> dict[str, Any]:
    return {
        "code": code,
        "name": name,
        "strike_time": expiry,
        "option_strike_price": strike,
        "option_type": option_type,
    }


def snapshot_row(code: str, strike: float, option_type: str, last: float = 10.0) -> dict[str, Any]:
    return {
        "code": code,
        "name": code.replace("US.", ""),
        "update_time": "2026-04-27 10:15:00",
        "last_price": last,
        "bid_price": last - 0.1,
        "ask_price": last + 0.1,
        "volume": 100,
        "option_open_interest": 250,
        "option_implied_volatility": 0.23,
        "option_delta": 0.51 if option_type == "CALL" else -0.49,
        "option_gamma": 0.0012,
        "option_vega": 0.8,
        "option_theta": -1.2,
        "option_rho": 0.03,
        "option_contract_multiplier": 100,
        "option_strike_price": strike,
        "option_type": option_type,
        "strike_time": "2026-04-27",
    }


def spx_config(**overrides: object) -> MoomooSymbolConfig:
    config = MoomooSymbolConfig(
        symbol="SPX",
        owner_code="US..SPX",
        strike_window_down=1,
        strike_window_up=1,
        publish_to_spx_dashboard=True,
        family_filter="SPXW",
        requires_manual_spot=True,
        manual_spot=7050.0,
    )
    return MoomooSymbolConfig(**{**config.__dict__, **overrides})


def test_select_atm_strikes_keeps_asymmetric_window_around_nearest_strike() -> None:
    strikes = [7030.0, 7040.0, 7050.0, 7060.0, 7070.0, 7080.0]

    assert select_atm_strikes(strikes, spot=7054.0, down=1, up=2) == [7040.0, 7050.0, 7060.0, 7070.0]


def test_discover_symbol_contracts_filters_family_and_selects_call_put_pairs() -> None:
    client = FakeMoomooQuoteClient(
        chains={
            "US..SPX": [
                chain_row("US.SPXW7050C", "SPXW 7050C", 7050, "CALL"),
                chain_row("US.SPXW7050P", "SPXW 7050P", 7050, "PUT"),
                chain_row("US.SPXW7060C", "SPXW 7060C", 7060, "CALL"),
                chain_row("US.SPXW7060P", "SPXW 7060P", 7060, "PUT"),
                chain_row("US.SPX7050C", "SPX 7050C", 7050, "CALL"),
            ]
        },
        snapshots={},
    )

    result = discover_symbol_contracts(client, spx_config(), expiry=date(2026, 4, 27))

    assert [contract.option_code for contract in result.contracts] == [
        "US.SPXW7050C",
        "US.SPXW7050P",
        "US.SPXW7060C",
        "US.SPXW7060P",
    ]
    assert result.warnings == []
    assert client.chain_calls == [("US..SPX", "2026-04-27", "2026-04-27")]


def test_discover_symbol_contracts_warns_and_falls_back_when_family_filter_matches_zero() -> None:
    client = FakeMoomooQuoteClient(
        chains={"US..RUT": [chain_row("US.RUT2050C", "RUT 2050C", 2050, "CALL")]},
        snapshots={},
    )
    config = MoomooSymbolConfig(
        symbol="RUT",
        owner_code="US..RUT",
        strike_window_down=0,
        strike_window_up=0,
        family_filter="RUTW",
        requires_manual_spot=True,
        manual_spot=2050.0,
    )

    result = discover_symbol_contracts(client, config, expiry=date(2026, 4, 27))

    assert [contract.option_code for contract in result.contracts] == ["US.RUT2050C"]
    assert result.warnings == ["RUT family filter RUTW matched zero rows; using unfiltered chain"]


def test_discover_symbol_contracts_skips_missing_required_manual_spot() -> None:
    client = FakeMoomooQuoteClient(chains={}, snapshots={})
    config = spx_config(manual_spot=None)

    result = discover_symbol_contracts(client, config, expiry=date(2026, 4, 27))

    assert result.contracts == []
    assert result.warnings == ["SPX requires manual spot and none was supplied"]
    assert client.chain_calls == []


def test_normalize_snapshot_record_maps_moomoo_option_fields() -> None:
    contract = MoomooContract(
        underlying="SPX",
        owner_code="US..SPX",
        option_code="US.SPXW7050C",
        option_name="SPXW 7050C",
        expiry="2026-04-27",
        option_type="call",
        strike=7050.0,
        contract_multiplier=100.0,
    )

    row = normalize_snapshot_record(contract, snapshot_row("US.SPXW7050C", 7050.0, "CALL"))

    assert row == MoomooOptionRow(
        underlying="SPX",
        owner_code="US..SPX",
        option_code="US.SPXW7050C",
        option_name="SPXW 7050C",
        expiry="2026-04-27",
        option_type="call",
        strike=7050.0,
        snapshot_time="2026-04-27 10:15:00",
        last_price=10.0,
        bid_price=9.9,
        ask_price=10.1,
        volume=100.0,
        open_interest=250.0,
        implied_volatility=0.23,
        delta=0.51,
        gamma=0.0012,
        vega=0.8,
        theta=-1.2,
        rho=0.03,
        contract_multiplier=100.0,
    )


def test_collect_moomoo_snapshot_once_fetches_full_universe_and_chunks_snapshots() -> None:
    contracts = [
        chain_row(f"US.SPXW{index}C", f"SPXW {index}C", 7000 + index, "CALL")
        for index in range(401)
    ]
    client = FakeMoomooQuoteClient(
        chains={"US..SPX": contracts},
        snapshots={
            f"US.SPXW{index}C": snapshot_row(f"US.SPXW{index}C", 7000 + index, "CALL")
            for index in range(401)
        },
    )
    config = MoomooCollectorConfig(
        refresh_interval_seconds=2.0,
        universe=[
            MoomooSymbolConfig(
                symbol="SPX",
                owner_code="US..SPX",
                strike_window_down=200,
                strike_window_up=200,
                publish_to_spx_dashboard=True,
                requires_manual_spot=True,
                manual_spot=7200.0,
            )
        ],
    )

    result = collect_moomoo_snapshot_once(client, config, expiry=date(2026, 4, 27))

    assert result.total_selected_codes == 401
    assert result.snapshot_rows_count == 401
    assert [len(call) for call in client.snapshot_calls] == [400, 1]
    assert result.rate_estimate.requests_per_refresh == 2


def test_main_prints_error_json_when_real_client_cannot_be_created(capsys: pytest.CaptureFixture[str]) -> None:
    def raise_missing() -> FakeMoomooQuoteClient:
        raise RuntimeError("moomoo-api package is not installed")

    with pytest.raises(SystemExit) as exc:
        main(["--expiry", "2026-04-27", "--spot", "SPX=7050", "--max-loops", "1"], client_factory=raise_missing)

    payload = capsys.readouterr().out
    assert exc.value.code == 1
    assert '"status":"error"' in payload
    assert "moomoo-api package is not installed" in payload
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_snapshot.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'gammascope_collector.moomoo_snapshot'`.

- [ ] **Step 3: Implement snapshot module and any required config helper refinements**

Create `services/collector/gammascope_collector/moomoo_snapshot.py` with these public dataclasses and functions:

```python
from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Protocol

from gammascope_collector.moomoo_config import (
    MoomooCollectorConfig,
    MoomooSymbolConfig,
    SNAPSHOT_CODE_LIMIT,
    SnapshotRateEstimate,
    chunked,
    estimate_snapshot_request_rate,
    parse_manual_spots,
    selected_symbols,
)

RET_OK = 0


class MoomooQuoteClient(Protocol):
    def query_subscription(self, is_all_conn: bool = True) -> tuple[int, Any]:
        ...

    def get_option_chain(self, code: str, start: str, end: str) -> tuple[int, Any]:
        ...

    def get_market_snapshot(self, code_list: list[str]) -> tuple[int, Any]:
        ...

    def close(self) -> None:
        ...


@dataclass(frozen=True)
class MoomooContract:
    underlying: str
    owner_code: str
    option_code: str
    option_name: str
    expiry: str
    option_type: str
    strike: float
    contract_multiplier: float = 100.0


@dataclass(frozen=True)
class MoomooOptionRow:
    underlying: str
    owner_code: str
    option_code: str
    option_name: str
    expiry: str
    option_type: str
    strike: float
    snapshot_time: str
    last_price: float | None
    bid_price: float | None
    ask_price: float | None
    volume: float | None
    open_interest: float | None
    implied_volatility: float | None
    delta: float | None
    gamma: float | None
    vega: float | None
    theta: float | None
    rho: float | None
    contract_multiplier: float

    @property
    def mid_price(self) -> float | None:
        if self.bid_price is None or self.ask_price is None:
            return None
        return (self.bid_price + self.ask_price) / 2


@dataclass(frozen=True)
class MoomooSymbolDiscoveryResult:
    symbol: str
    owner_code: str
    spot: float | None
    contracts: list[MoomooContract]
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class MoomooSnapshotResult:
    status: str
    subscription: dict[str, Any]
    symbol_results: list[MoomooSymbolDiscoveryResult]
    rows: list[MoomooOptionRow]
    warnings: list[str]
    rate_estimate: SnapshotRateEstimate

    @property
    def total_selected_codes(self) -> int:
        return sum(len(result.contracts) for result in self.symbol_results)

    @property
    def snapshot_rows_count(self) -> int:
        return len(self.rows)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "subscription": self.subscription,
            "total_selected_codes": self.total_selected_codes,
            "snapshot_rows_count": self.snapshot_rows_count,
            "warnings": self.warnings,
            "rate_estimate": asdict(self.rate_estimate),
            "symbols": [
                {
                    "symbol": result.symbol,
                    "owner_code": result.owner_code,
                    "spot": result.spot,
                    "selected_contracts": len(result.contracts),
                    "warnings": result.warnings,
                }
                for result in self.symbol_results
            ],
        }


ClientFactory = Callable[[], MoomooQuoteClient]


def select_atm_strikes(strikes: Sequence[float], *, spot: float, down: int, up: int) -> list[float]:
    unique_strikes = sorted({float(strike) for strike in strikes})
    if not unique_strikes:
        return []
    atm_index = min(range(len(unique_strikes)), key=lambda index: (abs(unique_strikes[index] - spot), unique_strikes[index]))
    lower_index = max(0, atm_index - down)
    upper_index = min(len(unique_strikes), atm_index + up + 1)
    return unique_strikes[lower_index:upper_index]


def discover_symbol_contracts(
    client: MoomooQuoteClient,
    symbol_config: MoomooSymbolConfig,
    *,
    expiry: date,
) -> MoomooSymbolDiscoveryResult:
    warnings: list[str] = []
    spot = symbol_config.manual_spot
    if symbol_config.requires_manual_spot and spot is None:
        return MoomooSymbolDiscoveryResult(
            symbol=symbol_config.symbol,
            owner_code=symbol_config.owner_code,
            spot=None,
            contracts=[],
            warnings=[f"{symbol_config.symbol} requires manual spot and none was supplied"],
        )
    if spot is None:
        spot = _spot_from_underlying_snapshot(client, symbol_config)
        if spot is None:
            return MoomooSymbolDiscoveryResult(
                symbol=symbol_config.symbol,
                owner_code=symbol_config.owner_code,
                spot=None,
                contracts=[],
                warnings=[f"{symbol_config.symbol} spot snapshot did not return a usable price"],
            )

    expiry_text = expiry.isoformat()
    ret, data = client.get_option_chain(code=symbol_config.owner_code, start=expiry_text, end=expiry_text)
    if ret != RET_OK:
        return MoomooSymbolDiscoveryResult(
            symbol=symbol_config.symbol,
            owner_code=symbol_config.owner_code,
            spot=spot,
            contracts=[],
            warnings=[f"{symbol_config.symbol} option chain request failed: {data}"],
        )

    records = [
        record
        for record in _records(data)
        if str(record.get("strike_time") or record.get("expiry") or "") == expiry_text
    ]
    filtered = records
    if symbol_config.family_filter:
        filtered = [
            record
            for record in records
            if symbol_config.family_filter.upper() in str(record.get("name") or record.get("code") or "").upper()
        ]
        if not filtered and records:
            warnings.append(
                f"{symbol_config.symbol} family filter {symbol_config.family_filter} matched zero rows; using unfiltered chain"
            )
            filtered = records

    strikes = select_atm_strikes(
        [_float(record.get("option_strike_price") or record.get("strike")) for record in filtered],
        spot=spot,
        down=symbol_config.strike_window_down,
        up=symbol_config.strike_window_up,
    )
    selected_strikes = set(strikes)
    contracts = [
        _contract_from_record(symbol_config, record, expiry_text)
        for record in filtered
        if _float(record.get("option_strike_price") or record.get("strike")) in selected_strikes
    ]
    contracts = sorted(contracts, key=lambda item: (item.strike, item.option_type, item.option_code))
    return MoomooSymbolDiscoveryResult(
        symbol=symbol_config.symbol,
        owner_code=symbol_config.owner_code,
        spot=spot,
        contracts=contracts,
        warnings=warnings,
    )


def collect_moomoo_snapshot_once(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    expiry: date,
) -> MoomooSnapshotResult:
    subscription = _subscription_dict(client)
    symbol_results = [
        discover_symbol_contracts(client, symbol_config, expiry=expiry)
        for symbol_config in selected_symbols(config)
    ]
    contracts_by_code = {
        contract.option_code: contract
        for result in symbol_results
        for contract in result.contracts
    }
    codes = sorted(contracts_by_code)
    rate_estimate = estimate_snapshot_request_rate(
        code_count=len(codes),
        refresh_interval_seconds=config.refresh_interval_seconds,
    )
    warnings = [warning for result in symbol_results for warning in result.warnings]
    if not rate_estimate.within_limit:
        warnings.append(
            f"Snapshot preflight exceeds limit: {rate_estimate.requests_per_30_seconds} requests per 30 seconds"
        )
    rows: list[MoomooOptionRow] = []
    for code_chunk in chunked(codes, SNAPSHOT_CODE_LIMIT):
        ret, data = client.get_market_snapshot(code_chunk)
        if ret != RET_OK:
            warnings.append(f"Snapshot request failed for {len(code_chunk)} codes: {data}")
            continue
        for record in _records(data):
            code = str(record.get("code") or "")
            contract = contracts_by_code.get(code)
            if contract is not None:
                rows.append(normalize_snapshot_record(contract, record))
    status = "connected" if rows else "degraded"
    return MoomooSnapshotResult(
        status=status,
        subscription=subscription,
        symbol_results=symbol_results,
        rows=rows,
        warnings=warnings,
        rate_estimate=rate_estimate,
    )


def run_moomoo_snapshot_loop(
    client: MoomooQuoteClient,
    config: MoomooCollectorConfig,
    *,
    expiry: date,
    max_loops: int | None = None,
) -> list[MoomooSnapshotResult]:
    results: list[MoomooSnapshotResult] = []
    loop_count = 0
    try:
        while max_loops is None or loop_count < max_loops:
            started = time.monotonic()
            results.append(collect_moomoo_snapshot_once(client, config, expiry=expiry))
            loop_count += 1
            if max_loops is not None and loop_count >= max_loops:
                break
            elapsed = time.monotonic() - started
            time.sleep(max(0.0, config.refresh_interval_seconds - elapsed))
    finally:
        client.close()
    return results


def normalize_snapshot_record(contract: MoomooContract, record: Mapping[str, Any]) -> MoomooOptionRow:
    return MoomooOptionRow(
        underlying=contract.underlying,
        owner_code=contract.owner_code,
        option_code=contract.option_code,
        option_name=str(record.get("name") or contract.option_name),
        expiry=str(record.get("strike_time") or contract.expiry),
        option_type=contract.option_type,
        strike=_float(record.get("option_strike_price") or contract.strike),
        snapshot_time=str(record.get("update_time") or ""),
        last_price=_optional_float(record.get("last_price")),
        bid_price=_optional_float(record.get("bid_price")),
        ask_price=_optional_float(record.get("ask_price")),
        volume=_optional_float(record.get("volume")),
        open_interest=_optional_float(record.get("option_open_interest")),
        implied_volatility=_optional_float(record.get("option_implied_volatility")),
        delta=_optional_float(record.get("option_delta")),
        gamma=_optional_float(record.get("option_gamma")),
        vega=_optional_float(record.get("option_vega")),
        theta=_optional_float(record.get("option_theta")),
        rho=_optional_float(record.get("option_rho")),
        contract_multiplier=_optional_float(record.get("option_contract_multiplier")) or contract.contract_multiplier,
    )


def main(argv: Sequence[str] | None = None, *, client_factory: ClientFactory | None = None) -> None:
    parser = argparse.ArgumentParser(description="Collect Moomoo 0DTE option snapshots.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11111)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--collector-id", default="local-moomoo")
    parser.add_argument("--expiry", type=_parse_date, default=date.today())
    parser.add_argument("--spot", action="append", default=[])
    parser.add_argument("--interval-seconds", type=float, default=2.0)
    parser.add_argument("--max-loops", type=int, default=1)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args(_normalize_argv(argv if argv is not None else sys.argv[1:]))

    config = MoomooCollectorConfig(
        host=args.host,
        port=args.port,
        api_base=args.api,
        collector_id=args.collector_id,
        refresh_interval_seconds=args.interval_seconds,
        manual_spots=parse_manual_spots(args.spot),
    )
    try:
        client = client_factory() if client_factory is not None else _create_real_client(config.host, config.port)
        results = run_moomoo_snapshot_loop(client, config, expiry=args.expiry, max_loops=args.max_loops)
    except Exception as exc:
        _print_json({"status": "error", "message": str(exc)})
        raise SystemExit(1) from exc

    _print_json(results[-1].as_dict() if results else {"status": "empty"})


def _create_real_client(host: str, port: int) -> MoomooQuoteClient:
    try:
        from moomoo import OpenQuoteContext
    except ImportError as exc:
        raise RuntimeError("moomoo-api package is not installed") from exc
    return OpenQuoteContext(host=host, port=port)


def _contract_from_record(symbol_config: MoomooSymbolConfig, record: Mapping[str, Any], expiry: str) -> MoomooContract:
    return MoomooContract(
        underlying=symbol_config.symbol,
        owner_code=symbol_config.owner_code,
        option_code=str(record.get("code")),
        option_name=str(record.get("name") or record.get("code")),
        expiry=expiry,
        option_type=_normalize_option_type(record.get("option_type")),
        strike=_float(record.get("option_strike_price") or record.get("strike")),
        contract_multiplier=_optional_float(record.get("option_contract_multiplier")) or 100.0,
    )


def _spot_from_underlying_snapshot(client: MoomooQuoteClient, symbol_config: MoomooSymbolConfig) -> float | None:
    ret, data = client.get_market_snapshot([symbol_config.owner_code])
    if ret != RET_OK:
        return None
    records = _records(data)
    if not records:
        return None
    record = records[0]
    return _optional_float(record.get("last_price") or record.get("close_price") or record.get("prev_close_price"))


def _subscription_dict(client: MoomooQuoteClient) -> dict[str, Any]:
    ret, data = client.query_subscription(is_all_conn=True)
    if ret != RET_OK:
        return {"error": str(data)}
    if isinstance(data, dict):
        return data
    return dict(data)


def _records(data: Any) -> list[dict[str, Any]]:
    if hasattr(data, "to_dict"):
        return list(data.to_dict("records"))
    return [dict(record) for record in data]


def _normalize_option_type(value: object) -> str:
    text = str(value).upper()
    if "CALL" in text or text == "C":
        return "call"
    if "PUT" in text or text == "P":
        return "put"
    raise ValueError(f"Unsupported option type: {value}")


def _float(value: object) -> float:
    return float(value)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _normalize_argv(argv: Sequence[str] | None) -> Sequence[str] | None:
    if argv and argv[0] == "--":
        return argv[1:]
    return argv


def _print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_snapshot.py services/collector/tests/test_moomoo_config.py -q
```

Expected: all focused Moomoo tests pass.

- [ ] **Step 5: Commit snapshot collector core**

Run:

```bash
git add services/collector/gammascope_collector/moomoo_config.py services/collector/gammascope_collector/moomoo_snapshot.py services/collector/tests/test_moomoo_config.py services/collector/tests/test_moomoo_snapshot.py
git commit -m "feat: add moomoo snapshot collector core"
```

## Task 3: SPX Compatibility Event Translation And Publishing

**Files:**

- Create: `services/collector/gammascope_collector/moomoo_compat.py`
- Create: `services/collector/tests/test_moomoo_compat.py`
- Modify: `services/collector/gammascope_collector/moomoo_snapshot.py`

- [ ] **Step 1: Write failing tests for compatibility event translation**

Create `services/collector/tests/test_moomoo_compat.py`:

```python
from __future__ import annotations

from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_collector.moomoo_compat import (
    moomoo_rows_to_spx_events,
    synthetic_ibkr_con_id,
)
from gammascope_collector.moomoo_snapshot import MoomooOptionRow, MoomooSnapshotResult
from gammascope_collector.moomoo_config import SnapshotRateEstimate


def row(
    *,
    underlying: str = "SPX",
    option_code: str = "US.SPXW7050C",
    option_type: str = "call",
    strike: float = 7050.0,
) -> MoomooOptionRow:
    return MoomooOptionRow(
        underlying=underlying,
        owner_code="US..SPX" if underlying == "SPX" else "US.SPY",
        option_code=option_code,
        option_name=option_code,
        expiry="2026-04-27",
        option_type=option_type,
        strike=strike,
        snapshot_time="2026-04-27 10:15:00",
        last_price=10.0,
        bid_price=9.9,
        ask_price=10.1,
        volume=100.0,
        open_interest=250.0,
        implied_volatility=0.23,
        delta=0.51 if option_type == "call" else -0.49,
        gamma=0.0012,
        vega=0.8,
        theta=-1.2,
        rho=0.03,
        contract_multiplier=100.0,
    )


def test_synthetic_ibkr_con_id_is_stable_positive_integer() -> None:
    assert synthetic_ibkr_con_id("US.SPXW7050C") == synthetic_ibkr_con_id("US.SPXW7050C")
    assert synthetic_ibkr_con_id("US.SPXW7050C") > 0
    assert synthetic_ibkr_con_id("US.SPXW7050C") != synthetic_ibkr_con_id("US.SPXW7050P")


def test_moomoo_rows_to_spx_events_filters_non_spx_and_validates_current_schema() -> None:
    events = moomoo_rows_to_spx_events(
        session_id="moomoo-spx-session",
        collector_id="local-moomoo",
        spot=7050.25,
        rows=[
            row(option_code="US.SPXW7050C", option_type="call", strike=7050),
            row(option_code="US.SPXW7050P", option_type="put", strike=7050),
            row(underlying="SPY", option_code="US.SPY700C", option_type="call", strike=700),
        ],
        status="connected",
        message="Moomoo compatibility snapshot emitted",
    )

    assert [type(CollectorEvents.model_validate(event).root).__name__ for event in events] == [
        "CollectorHealth",
        "UnderlyingTick",
        "ContractDiscovered",
        "ContractDiscovered",
        "OptionTick",
        "OptionTick",
    ]
    assert {event["source"] for event in events} == {"ibkr"}
    assert {event.get("symbol") for event in events if "symbol" in event} == {"SPX"}
    assert all("SPY" not in str(event) for event in events)


def test_moomoo_rows_to_spx_events_returns_health_only_when_no_spx_rows() -> None:
    events = moomoo_rows_to_spx_events(
        session_id="moomoo-empty",
        collector_id="local-moomoo",
        spot=None,
        rows=[row(underlying="SPY", option_code="US.SPY700C", strike=700)],
        status="degraded",
        message="No publishable SPX rows",
    )

    assert len(events) == 1
    assert type(CollectorEvents.model_validate(events[0]).root).__name__ == "CollectorHealth"
    assert events[0]["status"] == "degraded"
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_compat.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'gammascope_collector.moomoo_compat'`.

- [ ] **Step 3: Implement compatibility translator**

Create `services/collector/gammascope_collector/moomoo_compat.py`:

```python
from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime

from gammascope_collector.events import (
    contract_discovered_event,
    contract_id,
    health_event,
    option_tick_event,
    underlying_tick_event,
)
from gammascope_collector.moomoo_snapshot import MoomooOptionRow


def synthetic_ibkr_con_id(option_code: str) -> int:
    digest = hashlib.sha256(option_code.encode("utf-8")).hexdigest()
    return int(digest[:12], 16) % 2_000_000_000 + 1


def moomoo_rows_to_spx_events(
    *,
    session_id: str,
    collector_id: str,
    spot: float | None,
    rows: Sequence[MoomooOptionRow],
    status: str,
    message: str,
) -> list[dict[str, object]]:
    event_time = _snapshot_event_time(rows)
    spx_rows = [row for row in rows if row.underlying == "SPX"]
    health = health_event(
        collector_id=collector_id,
        status=status,
        ibkr_account_mode="unknown",
        message=message,
        event_time=event_time,
        received_time=datetime.now(UTC),
    )
    if not spx_rows or spot is None:
        return [health]

    contracts = [
        contract_discovered_event(
            session_id=session_id,
            ibkr_con_id=synthetic_ibkr_con_id(row.option_code),
            symbol="SPX",
            expiry=row.expiry,
            right=row.option_type,
            strike=row.strike,
            multiplier=row.contract_multiplier,
            exchange="Moomoo",
            currency="USD",
            event_time=event_time,
        )
        for row in spx_rows
    ]
    ticks = [
        option_tick_event(
            session_id=session_id,
            contract_id=contract_id("SPX", row.expiry, row.option_type, row.strike),
            bid=row.bid_price,
            ask=row.ask_price,
            last=row.last_price,
            bid_size=None,
            ask_size=None,
            volume=row.volume,
            open_interest=row.open_interest,
            ibkr_iv=row.implied_volatility,
            ibkr_delta=row.delta,
            ibkr_gamma=row.gamma,
            ibkr_vega=row.vega,
            ibkr_theta=row.theta,
            event_time=event_time,
        )
        for row in spx_rows
    ]
    underlying = underlying_tick_event(
        session_id=session_id,
        bid=None,
        ask=None,
        last=spot,
        event_time=event_time,
        symbol="SPX",
    )
    return [health, underlying, *contracts, *ticks]


def _snapshot_event_time(rows: Sequence[MoomooOptionRow]) -> datetime:
    for row in rows:
        if row.snapshot_time:
            try:
                return datetime.fromisoformat(row.snapshot_time.replace("Z", "+00:00")).astimezone(UTC)
            except ValueError:
                break
    return datetime.now(UTC)
```

- [ ] **Step 4: Extend CLI publish mode**

Modify `services/collector/gammascope_collector/moomoo_snapshot.py`:

```python
from uuid import uuid4

from gammascope_collector.moomoo_compat import moomoo_rows_to_spx_events
from gammascope_collector.publisher import publish_events
```

Inside `main`, after `results = run_moomoo_snapshot_loop(...)`, publish the final result when `args.publish` is true:

```python
    final_result = results[-1] if results else None
    publish_summary = None
    if args.publish and final_result is not None:
        spx_spot = _spot_for_symbol(final_result, "SPX")
        events = moomoo_rows_to_spx_events(
            session_id=f"moomoo-spx-0dte-{uuid4()}",
            collector_id=config.collector_id,
            spot=spx_spot,
            rows=final_result.rows,
            status=final_result.status,
            message=_health_message(final_result),
        )
        publish_summary = publish_events(events, api_base=config.api_base).as_dict()

    payload = final_result.as_dict() if final_result is not None else {"status": "empty"}
    if publish_summary is not None:
        payload["publish"] = publish_summary
    _print_json(payload)
```

Add these helpers in the same module:

```python
def _spot_for_symbol(result: MoomooSnapshotResult, symbol: str) -> float | None:
    for symbol_result in result.symbol_results:
        if symbol_result.symbol == symbol:
            return symbol_result.spot
    return None


def _health_message(result: MoomooSnapshotResult) -> str:
    warning_count = len(result.warnings)
    if warning_count:
        return f"Moomoo compatibility snapshot emitted with {warning_count} warnings"
    return "Moomoo compatibility snapshot emitted"
```

- [ ] **Step 5: Add CLI publish test**

Append to `services/collector/tests/test_moomoo_snapshot.py`:

```python
def test_main_publish_mode_adds_publish_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    client = FakeMoomooQuoteClient(
        chains={
            "US..SPX": [
                chain_row("US.SPXW7050C", "SPXW 7050C", 7050, "CALL"),
                chain_row("US.SPXW7050P", "SPXW 7050P", 7050, "PUT"),
            ]
        },
        snapshots={
            "US.SPXW7050C": snapshot_row("US.SPXW7050C", 7050, "CALL"),
            "US.SPXW7050P": snapshot_row("US.SPXW7050P", 7050, "PUT"),
        },
    )
    published: list[dict[str, object]] = []

    def fake_publish(events: list[dict[str, object]], *, api_base: str):
        from gammascope_collector.publisher import PublishSummary

        published.extend(events)
        return PublishSummary(endpoint=f"{api_base}/api/spx/0dte/collector/events", accepted_count=len(events), event_types=[])

    monkeypatch.setattr("gammascope_collector.moomoo_snapshot.publish_events", fake_publish)

    main(
        ["--expiry", "2026-04-27", "--spot", "SPX=7050", "--max-loops", "1", "--publish"],
        client_factory=lambda: client,
    )

    payload = capsys.readouterr().out
    assert '"publish":{"accepted_count":6' in payload
    assert len(published) == 6
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_compat.py services/collector/tests/test_moomoo_snapshot.py -q
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit compatibility translation**

Run:

```bash
git add services/collector/gammascope_collector/moomoo_compat.py services/collector/gammascope_collector/moomoo_snapshot.py services/collector/tests/test_moomoo_compat.py services/collector/tests/test_moomoo_snapshot.py
git commit -m "feat: publish moomoo spx compatibility events"
```

## Task 4: Package Script And README Usage

**Files:**

- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add package script**

Modify the root `package.json` scripts section to include:

```json
"collector:moomoo-snapshot": "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.moomoo_snapshot"
```

Keep the existing IBKR scripts unchanged.

- [ ] **Step 2: Add README section**

Add this section after the current "Local IBKR Delayed Snapshot" section in `README.md`:

```markdown
### Local Moomoo 0DTE Snapshot

Moomoo is the default direction for new live-source work. The first Moomoo collector uses local OpenD and keeps the current SPX dashboard contract by publishing only SPX rows into the existing collector event path.

Install the Moomoo package in the project virtualenv:

    .venv/bin/python -m pip install --upgrade moomoo-api pandas

Start Moomoo OpenD locally and confirm it is listening on:

    host=127.0.0.1
    port=11111

Run one snapshot loop. Manual spot is required for index symbols where direct Moomoo index snapshots may not return usable spot values:

    pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1

Publish SPX compatibility events into the local FastAPI ingestion path:

    pnpm dev:api
    pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1 --publish

The collector fetches the configured universe: SPX, SPY, QQQ, IWM, RUT, and NDX. It polls `get_market_snapshot()` every 2 seconds when running multiple loops and chunks requests to at most 400 option codes. It uses `get_option_chain()` only for startup contract discovery.
```

- [ ] **Step 3: Run script and collector tests**

Run:

```bash
pnpm test:scripts
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py services/collector/tests/test_moomoo_snapshot.py services/collector/tests/test_moomoo_compat.py -q
pnpm collector:moomoo-snapshot -- --help
```

Expected:

- `pnpm test:scripts` passes.
- Focused Moomoo collector tests pass.
- Help output includes `Collect Moomoo 0DTE option snapshots`.

- [ ] **Step 4: Commit script and docs**

Run:

```bash
git add package.json README.md
git commit -m "docs: add moomoo collector usage"
```

## Task 5: Web Source Preference Helpers And Selector Component

**Files:**

- Create: `apps/web/lib/sourcePreference.ts`
- Create: `apps/web/components/SourceSelector.tsx`
- Create: `apps/web/tests/sourcePreference.test.ts`
- Create: `apps/web/tests/SourceSelector.test.tsx`

- [ ] **Step 1: Write failing source preference tests**

Create `apps/web/tests/sourcePreference.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_SOURCE,
  DATA_SOURCE_STORAGE_KEY,
  isDataSourcePreference,
  loadDataSourcePreference,
  saveDataSourcePreference
} from "../lib/sourcePreference";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("sourcePreference", () => {
  it("defaults to Moomoo", () => {
    expect(DEFAULT_DATA_SOURCE).toBe("moomoo");
    expect(loadDataSourcePreference(new MemoryStorage())).toBe("moomoo");
  });

  it("validates supported source values", () => {
    expect(isDataSourcePreference("moomoo")).toBe(true);
    expect(isDataSourcePreference("ibkr")).toBe(true);
    expect(isDataSourcePreference("mock")).toBe(false);
  });

  it("loads saved valid preference and ignores invalid values", () => {
    const storage = new MemoryStorage();
    storage.setItem(DATA_SOURCE_STORAGE_KEY, "ibkr");
    expect(loadDataSourcePreference(storage)).toBe("ibkr");

    storage.setItem(DATA_SOURCE_STORAGE_KEY, "bad");
    expect(loadDataSourcePreference(storage)).toBe("moomoo");
  });

  it("saves selected preference", () => {
    const storage = new MemoryStorage();
    saveDataSourcePreference("ibkr", storage);
    expect(storage.getItem(DATA_SOURCE_STORAGE_KEY)).toBe("ibkr");
  });
});
```

- [ ] **Step 2: Write failing selector component tests**

Create `apps/web/tests/SourceSelector.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceSelector } from "../components/SourceSelector";

describe("SourceSelector", () => {
  it("renders Moomoo and IBKR options with Moomoo selected by default", () => {
    const markup = renderToStaticMarkup(<SourceSelector value="moomoo" onChange={vi.fn()} />);

    expect(markup).toContain("Data source");
    expect(markup).toContain("Moomoo");
    expect(markup).toContain("IBKR");
    expect(markup).toMatch(/option selected="" value="moomoo"/);
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- sourcePreference.test.ts SourceSelector.test.tsx
```

Expected: fail with missing module errors for `sourcePreference` and `SourceSelector`.

- [ ] **Step 4: Implement source preference helpers**

Create `apps/web/lib/sourcePreference.ts`:

```typescript
export const DATA_SOURCE_STORAGE_KEY = "gammascope:data-source";
export const DATA_SOURCE_OPTIONS = ["moomoo", "ibkr"] as const;
export const DEFAULT_DATA_SOURCE = "moomoo" satisfies DataSourcePreference;

export type DataSourcePreference = (typeof DATA_SOURCE_OPTIONS)[number];

export function isDataSourcePreference(value: unknown): value is DataSourcePreference {
  return typeof value === "string" && DATA_SOURCE_OPTIONS.includes(value as DataSourcePreference);
}

export function loadDataSourcePreference(storage: Pick<Storage, "getItem"> | null | undefined): DataSourcePreference {
  const value = storage?.getItem(DATA_SOURCE_STORAGE_KEY);
  return isDataSourcePreference(value) ? value : DEFAULT_DATA_SOURCE;
}

export function saveDataSourcePreference(
  value: DataSourcePreference,
  storage: Pick<Storage, "setItem"> | null | undefined
): void {
  storage?.setItem(DATA_SOURCE_STORAGE_KEY, value);
}

export function formatDataSourcePreference(value: DataSourcePreference): string {
  return value === "moomoo" ? "Moomoo" : "IBKR";
}
```

- [ ] **Step 5: Implement source selector component**

Create `apps/web/components/SourceSelector.tsx`:

```tsx
import React from "react";
import type { DataSourcePreference } from "../lib/sourcePreference";
import { DATA_SOURCE_OPTIONS, formatDataSourcePreference } from "../lib/sourcePreference";

interface SourceSelectorProps {
  value: DataSourcePreference;
  onChange: (value: DataSourcePreference) => void;
}

export function SourceSelector({ value, onChange }: SourceSelectorProps) {
  return (
    <label className="sourceSelector">
      <span>Data source</span>
      <select
        aria-label="Data source"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as DataSourcePreference)}
      >
        {DATA_SOURCE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {formatDataSourcePreference(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 6: Run focused web tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- sourcePreference.test.ts SourceSelector.test.tsx
```

Expected: both focused test files pass.

- [ ] **Step 7: Commit web selector foundations**

Run:

```bash
git add apps/web/lib/sourcePreference.ts apps/web/components/SourceSelector.tsx apps/web/tests/sourcePreference.test.ts apps/web/tests/SourceSelector.test.tsx
git commit -m "feat: add dashboard source selector foundation"
```

## Task 6: Wire Source Selector Into Dashboard

**Files:**

- Modify: `apps/web/components/LiveDashboard.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/tests/LiveDashboard.test.tsx`

- [ ] **Step 1: Write failing dashboard render test**

Append to `apps/web/tests/LiveDashboard.test.tsx`:

```tsx
  it("defaults the dashboard source selector to Moomoo", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("Data source");
    expect(markup).toContain("Moomoo");
    expect(markup).toMatch(/option selected="" value="moomoo"/);
  });
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- LiveDashboard.test.tsx
```

Expected: fail because the dashboard does not render the source selector yet.

- [ ] **Step 3: Add source preference state to LiveDashboard**

Modify imports in `apps/web/components/LiveDashboard.tsx`:

```tsx
import type { DataSourcePreference } from "../lib/sourcePreference";
import {
  DEFAULT_DATA_SOURCE,
  loadDataSourcePreference,
  saveDataSourcePreference
} from "../lib/sourcePreference";
```

Inside `LiveDashboard`, add state near the other `useState` calls:

```tsx
  const [selectedDataSource, setSelectedDataSource] = useState<DataSourcePreference>(DEFAULT_DATA_SOURCE);
```

Add this effect:

```tsx
  useEffect(() => {
    setSelectedDataSource(loadDataSourcePreference(globalThis.window?.localStorage));
  }, []);
```

Add this callback:

```tsx
  const handleSelectedDataSourceChange = (value: DataSourcePreference) => {
    setSelectedDataSource(value);
    saveDataSourcePreference(value, globalThis.window?.localStorage);
  };
```

Where `DashboardView` is rendered, pass:

```tsx
        selectedDataSource={selectedDataSource}
        onSelectedDataSourceChange={handleSelectedDataSourceChange}
```

- [ ] **Step 4: Render selector in DashboardView**

Modify imports in `apps/web/components/DashboardView.tsx`:

```tsx
import { SourceSelector } from "./SourceSelector";
import type { DataSourcePreference } from "../lib/sourcePreference";
import { formatDataSourcePreference } from "../lib/sourcePreference";
```

Extend `DashboardView` props:

```tsx
  selectedDataSource: DataSourcePreference;
  onSelectedDataSourceChange: (value: DataSourcePreference) => void;
```

Destructure those props in the component parameters. In the top bar utility, render the selector before the existing `statusRail`:

```tsx
          <SourceSelector value={selectedDataSource} onChange={onSelectedDataSourceChange} />
          <div className="sourcePreferenceLabel" aria-label="Preferred data source">
            Preferred {formatDataSourcePreference(selectedDataSource)}
          </div>
```

- [ ] **Step 5: Add compact styles**

Append to `apps/web/app/styles.css` near the top-bar/status styles:

```css
.sourceSelector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  color: var(--muted);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.sourceSelector select {
  min-height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(7, 12, 24, 0.92);
  color: var(--text);
  font: inherit;
  text-transform: none;
  padding: 3px 8px;
}

.sourcePreferenceLabel {
  color: var(--muted);
  font-size: 0.72rem;
  white-space: nowrap;
}
```

- [ ] **Step 6: Run focused dashboard tests**

Run:

```bash
pnpm --filter @gammascope/web test -- sourcePreference.test.ts SourceSelector.test.tsx LiveDashboard.test.tsx
pnpm --filter @gammascope/web typecheck
```

Expected: focused tests and typecheck pass.

- [ ] **Step 7: Commit dashboard wiring**

Run:

```bash
git add apps/web/components/LiveDashboard.tsx apps/web/components/DashboardView.tsx apps/web/app/styles.css apps/web/tests/LiveDashboard.test.tsx
git commit -m "feat: default dashboard source to moomoo"
```

## Task 7: Final Verification And Optional OpenD Smoke

**Files:**

- Modify: `docs/superpowers/plans/2026-04-27-moomoo-data-source.md`

- [ ] **Step 1: Run collector verification**

Run:

```bash
PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py services/collector/tests/test_moomoo_snapshot.py services/collector/tests/test_moomoo_compat.py -q
pnpm test:collector
```

Expected: Moomoo focused tests pass, then the full collector suite passes.

- [ ] **Step 2: Run web verification**

Run:

```bash
pnpm --filter @gammascope/web typecheck
pnpm --filter @gammascope/web test
```

Expected: web typecheck and all web tests pass.

- [ ] **Step 3: Run contract, API, and script verification**

Run:

```bash
pnpm test:scripts
pnpm test:contracts
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q
```

Expected: package script validation, shared contract tests, and API tests pass.

- [ ] **Step 4: Run lint and whitespace checks**

Run:

```bash
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
git diff --check
```

Expected: ruff reports `All checks passed!`; `git diff --check` exits with no output.

- [ ] **Step 5: Optional local Moomoo smoke with OpenD**

Run only when local OpenD is running and `moomoo-api` is installed:

```bash
pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1
```

Expected JSON characteristics:

```text
"status":"connected" or "status":"degraded"
"total_selected_codes" present
"symbols" contains SPX, SPY, QQQ, IWM, RUT, NDX when chains are available
"rate_estimate":{"requests_per_refresh":2,"requests_per_30_seconds":30,"within_limit":true}
```

If OpenD is unavailable, record that this smoke was skipped and keep the automated fake-client tests as verification.

- [ ] **Step 6: Optional local publish smoke**

Run only when FastAPI and OpenD are both running:

```bash
pnpm dev:api
pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1 --publish
curl -s http://127.0.0.1:8000/api/spx/0dte/collector/state | python -m json.tool
curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | python -m json.tool
```

Expected:

- Publish output includes an accepted count greater than zero when SPX rows exist.
- Collector state has `latest_health.collector_id` equal to `local-moomoo`.
- Latest snapshot remains `symbol: "SPX"` and `mode: "live"` when enough SPX rows were published.

- [ ] **Step 7: Update this plan with evidence**

Append an `## Evidence` section to this file with exact commands run and pass/fail results. Use this format:

```markdown
## Evidence

- `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py services/collector/tests/test_moomoo_snapshot.py services/collector/tests/test_moomoo_compat.py -q` passed.
- `pnpm test:collector` passed.
- `pnpm --filter @gammascope/web typecheck` passed.
- `pnpm --filter @gammascope/web test` passed.
- `pnpm test:scripts` passed.
- `pnpm test:contracts` passed.
- `PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q` passed.
- `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- `git diff --check` passed.
- Local Moomoo OpenD smoke was run or skipped because OpenD was unavailable.
```

- [ ] **Step 8: Commit final verification evidence**

Run:

```bash
git add docs/superpowers/plans/2026-04-27-moomoo-data-source.md
git commit -m "docs: record moomoo data source verification"
```

## Evidence

- `PYTHONPATH=services/collector:apps/api .venv/bin/pytest services/collector/tests/test_moomoo_config.py services/collector/tests/test_moomoo_snapshot.py services/collector/tests/test_moomoo_compat.py -q` passed with `35 passed in 0.41s`.
- `pnpm test:collector` passed with `135 passed in 1.21s`.
- `pnpm --filter @gammascope/web typecheck` passed.
- `pnpm --filter @gammascope/web test` passed with `40 passed` test files and `341 passed` tests.
- `pnpm test:scripts` passed with `3` tests.
- `pnpm test:contracts` passed with `6` tests.
- `PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q` passed with `179 passed, 1 skipped in 22.86s`.
- `.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector` passed with `All checks passed!`.
- `git diff --check` passed with no output.
- `.venv/bin/python -m pip install --upgrade moomoo-api pandas` passed in the local worktree venv to enable the OpenD smoke.
- `pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1` passed against local OpenD with `status: connected`, `total_selected_codes: 448`, `snapshot_rows_count: 448`, and `rate_estimate: {"requests_per_refresh": 2, "requests_per_30_seconds": 30, "within_limit": true}`.
- `pnpm dev:api` started FastAPI locally for the publish smoke and was shut down cleanly afterward.
- `pnpm collector:moomoo-snapshot -- --expiry 2026-04-27 --spot SPX=7050 --spot RUT=2050 --spot NDX=18300 --max-loops 1 --publish` passed with `status: connected`, `snapshot_rows_count: 448`, and `publish.accepted_count: 246`.
- `curl -s http://127.0.0.1:8000/api/spx/0dte/collector/state | .venv/bin/python -m json.tool` passed and returned `latest_health.collector_id: "local-moomoo"`, `contracts_count: 122`, and `option_ticks_count: 122`.
- `curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | .venv/bin/python -m json.tool` passed and returned `symbol: "SPX"` and `mode: "live"`.
