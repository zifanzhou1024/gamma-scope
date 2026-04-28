# SPX 0DTE Exposure Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated SPXW 0DTE exposure heatmap API and latest-ladder `/heatmap` page using Moomoo-sourced snapshots, 09:25 ET OI baseline logic, signed OI-proxy GEX/VEX, and Postgres persistence for all snapshots plus 5-minute buckets.

**Architecture:** Keep the heatmap isolated from the current realtime and replay dashboards. Backend heatmap modules derive a normalized payload from the existing `AnalyticsSnapshot`, lock or provisionally use the Moomoo OI baseline, persist full heatmap history and 5-minute buckets, and serve `/api/spx/0dte/heatmap/latest`. The frontend adds a separate `/heatmap` page that consumes the heatmap API, renders one SPXW ladder panel, and activates the existing Heatmap nav link.

**Tech Stack:** FastAPI, Python 3.11, psycopg/Postgres, pytest, Next.js App Router, React, TypeScript, Vitest, existing GammaScope analytics contracts and Moomoo compatibility ingestion.

---

Spec: `docs/superpowers/specs/2026-04-28-spx-0dte-exposure-heatmap-design.md`

## Execution Rules

- Before implementation starts, use `superpowers:using-git-worktrees` and create an isolated implementation branch/worktree. Do not implement on `main`.
- Execute this plan with `superpowers:subagent-driven-development`.
- Each implementer subagent must use `superpowers:test-driven-development`.
- Do not write production code before the failing test for that behavior has been run and observed failing.
- Before claiming any task, phase, or full implementation is complete, use `superpowers:verification-before-completion` and run the exact verification commands listed for that task.
- Keep commits frequent and scoped to the task that produced them.

## Scope Check

This plan covers one coherent feature slice:

- Backend calculation and API.
- Postgres heatmap persistence.
- Latest-only frontend heatmap page.

It intentionally does not implement replay UI/API integration, multi-symbol heatmap panels, flow-adjusted dealer inventory, or generalized collector schema changes.

## File Structure

Backend files:

- Create `apps/api/gammascope_api/heatmap/__init__.py`
  - Package marker and small public exports if needed.
- Create `apps/api/gammascope_api/heatmap/exposure.py`
  - Dataclasses, signed OI-proxy exposure formulas, strike aggregation, and money formatting.
- Create `apps/api/gammascope_api/heatmap/nodes.py`
  - King, positive king, negative king, above-spot wall, and below-spot wall detection.
- Create `apps/api/gammascope_api/heatmap/normalization.py`
  - Percentile/square-root color normalization, New York market-date helpers, 5-minute bucket helpers, and row tag helpers.
- Create `apps/api/gammascope_api/heatmap/repository.py`
  - Repository protocol, in-memory repository for tests/fallbacks, and Postgres repository with schema creation and upserts.
- Create `apps/api/gammascope_api/heatmap/dependencies.py`
  - Database URL wiring and repository override hooks for route tests.
- Create `apps/api/gammascope_api/heatmap/service.py`
  - Orchestrates live snapshot to heatmap payload conversion, OI baseline lookup/locking, and persistence.
- Create `apps/api/gammascope_api/routes/heatmap.py`
  - FastAPI latest heatmap route.
- Modify `apps/api/gammascope_api/main.py`
  - Include the heatmap router.

Backend tests:

- Create `apps/api/tests/test_heatmap_exposure.py`
- Create `apps/api/tests/test_heatmap_nodes.py`
- Create `apps/api/tests/test_heatmap_repository.py`
- Create `apps/api/tests/test_heatmap_service.py`
- Create `apps/api/tests/test_heatmap_route.py`

Frontend files:

- Create `apps/web/lib/clientHeatmapSource.ts`
  - Heatmap payload types, type guard, and client fetcher.
- Create `apps/web/lib/heatmapFormat.ts`
  - Formatting helpers and color class helpers.
- Create `apps/web/components/HeatmapToolbar.tsx`
  - Metric toggle, center controls, and range selector.
- Create `apps/web/components/HeatmapNodePanel.tsx`
  - Node cards and baseline/persistence status display.
- Create `apps/web/components/ExposureHeatmap.tsx`
  - Main ladder rendering and scroll-to-spot/king behavior.
- Create `apps/web/app/heatmap/page.tsx`
  - Heatmap page shell and server-side initial fetch.
- Create `apps/web/app/api/spx/0dte/heatmap/latest/route.ts`
  - Next.js proxy to FastAPI.
- Modify `apps/web/components/DashboardView.tsx`
  - Replace disabled Heatmap nav span with an active link and active-state support.
- Modify `apps/web/components/LiveDashboard.tsx`
  - Pass `activeDashboard="realtime"` unchanged; no heatmap-specific live dashboard changes.
- Modify `apps/web/components/ReplayDashboard.tsx`
  - Pass `activeDashboard="replay"` unchanged; no heatmap-specific replay behavior.
- Modify `apps/web/app/styles.css`
  - Add heatmap page, toolbar, ladder, node panel, status, and responsive styles.

Frontend tests:

- Create `apps/web/tests/clientHeatmapSource.test.ts`
- Create `apps/web/tests/heatmapFormat.test.ts`
- Create `apps/web/tests/ExposureHeatmap.test.tsx`
- Create `apps/web/tests/HeatmapPage.test.tsx`
- Modify `apps/web/tests/LiveDashboard.test.tsx`
- Modify `apps/web/tests/ReplayDashboard.test.tsx`

## Task 0: Create Isolated Implementation Branch Or Worktree

**Files:**

- No source files changed.

- [ ] **Step 1: Check current branch and status**

Run:

```bash
git branch --show-current
git status --short
```

Expected:

```text
main
```

and no unexpected working tree changes. If unrelated changes exist, stop and ask before proceeding.

- [ ] **Step 2: Create an isolated implementation branch**

Run:

```bash
git switch -c codex/spx-0dte-exposure-heatmap
```

Expected:

```text
Switched to a new branch 'codex/spx-0dte-exposure-heatmap'
```

- [ ] **Step 3: Verify branch**

Run:

```bash
git branch --show-current
```

Expected:

```text
codex/spx-0dte-exposure-heatmap
```

## Task 1: Backend Exposure Calculations

**Files:**

- Create: `apps/api/gammascope_api/heatmap/__init__.py`
- Create: `apps/api/gammascope_api/heatmap/exposure.py`
- Create: `apps/api/tests/test_heatmap_exposure.py`

- [ ] **Step 1: Write failing tests for signed GEX, VEX, missing inputs, and formatting**

Create `apps/api/tests/test_heatmap_exposure.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_exposure.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'gammascope_api.heatmap'`.

- [ ] **Step 3: Implement minimal exposure module**

Create `apps/api/gammascope_api/heatmap/__init__.py`:

```python
"""SPX 0DTE heatmap calculations and persistence."""
```

Create `apps/api/gammascope_api/heatmap/exposure.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


CONTRACT_MULTIPLIER_SPX = 100
GEX_ONE_PERCENT_MOVE = 0.01
OptionRight = Literal["call", "put"]


@dataclass(frozen=True)
class HeatmapContractInput:
    contract_id: str
    right: str
    strike: float
    baseline_open_interest: int | None
    custom_gamma: float | None
    custom_vanna: float | None


@dataclass
class StrikeExposure:
    strike: float
    gex: float = 0.0
    vex: float = 0.0
    call_gex: float = 0.0
    put_gex: float = 0.0
    call_vex: float = 0.0
    put_vex: float = 0.0
    tags: list[str] = field(default_factory=list)


def aggregate_exposure_by_strike(
    contracts: list[HeatmapContractInput],
    *,
    spot: float,
    multiplier: int = CONTRACT_MULTIPLIER_SPX,
) -> list[StrikeExposure]:
    grouped: dict[float, StrikeExposure] = {}
    spot_scale = multiplier * spot * spot * GEX_ONE_PERCENT_MOVE
    vex_scale = multiplier * spot

    for contract in contracts:
        row = grouped.setdefault(contract.strike, StrikeExposure(strike=contract.strike))
        if contract.baseline_open_interest is None:
            _append_tag(row, "missing_oi_baseline")
            continue
        if contract.custom_gamma is None or contract.custom_vanna is None:
            _append_tag(row, "missing_greek")
            continue

        side_sign = 1 if contract.right == "call" else -1
        quantity = side_sign * contract.baseline_open_interest
        gex = quantity * contract.custom_gamma * spot_scale
        vex = quantity * contract.custom_vanna * vex_scale

        if contract.right == "call":
            row.call_gex += gex
            row.call_vex += vex
        else:
            row.put_gex += gex
            row.put_vex += vex
        row.gex += gex
        row.vex += vex

    return [grouped[strike] for strike in sorted(grouped)]


def format_money(value: float) -> str:
    sign = "-$" if value < 0 else "$"
    magnitude = abs(value)
    if magnitude >= 1_000_000_000:
        return f"{sign}{magnitude / 1_000_000_000:.1f}B"
    if magnitude >= 1_000_000:
        return f"{sign}{magnitude / 1_000_000:.1f}M"
    if magnitude >= 1_000:
        return f"{sign}{magnitude / 1_000:.1f}K"
    return f"{sign}{magnitude:.0f}"


def _append_tag(row: StrikeExposure, tag: str) -> None:
    if tag not in row.tags:
        row.tags.append(tag)
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_exposure.py -q
```

Expected: all tests in `test_heatmap_exposure.py` pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/api/gammascope_api/heatmap/__init__.py apps/api/gammascope_api/heatmap/exposure.py apps/api/tests/test_heatmap_exposure.py
git commit -m "feat: add heatmap exposure calculations"
```

## Task 2: Backend Node Detection And Normalization

**Files:**

- Create: `apps/api/gammascope_api/heatmap/nodes.py`
- Create: `apps/api/gammascope_api/heatmap/normalization.py`
- Create: `apps/api/tests/test_heatmap_nodes.py`

- [ ] **Step 1: Write failing tests for nodes, color normalization, market date, and bucket floor**

Create `apps/api/tests/test_heatmap_nodes.py`:

```python
from __future__ import annotations

import pytest

from gammascope_api.heatmap.exposure import StrikeExposure
from gammascope_api.heatmap.nodes import derive_nodes
from gammascope_api.heatmap.normalization import (
    color_norms_by_strike,
    five_minute_bucket_start,
    market_date_new_york,
    percentile,
)


def _row(strike: float, value: float) -> StrikeExposure:
    return StrikeExposure(strike=strike, gex=value, vex=value)


def test_derive_nodes_finds_kings_and_spot_walls() -> None:
    rows = [_row(7150, 8_000_000), _row(7175, -31_000_000), _row(7200, 12_000_000), _row(7225, 1_000_000)]

    nodes = derive_nodes(rows, spot=7173.91, metric="gex")

    assert nodes["king"] == {"strike": 7175, "value": -31_000_000}
    assert nodes["positiveKing"] == {"strike": 7200, "value": 12_000_000}
    assert nodes["negativeKing"] == {"strike": 7175, "value": -31_000_000}
    assert nodes["aboveWall"] == {"strike": 7200, "value": 12_000_000}
    assert nodes["belowWall"] == {"strike": 7150, "value": 8_000_000}


def test_derive_nodes_returns_none_values_for_empty_rows() -> None:
    assert derive_nodes([], spot=7173.91, metric="gex") == {
        "king": None,
        "positiveKing": None,
        "negativeKing": None,
        "aboveWall": None,
        "belowWall": None,
    }


def test_percentile_interpolates_sorted_values() -> None:
    assert percentile([1, 2, 3, 4, 5], 95) == pytest.approx(4.8)
    assert percentile([5, 1, 3], 50) == pytest.approx(3)
    assert percentile([], 95) == 0


def test_color_norms_use_percentile_sqrt_scaling() -> None:
    rows = [_row(7150, 1), _row(7175, 4), _row(7200, 100)]

    norms = color_norms_by_strike(rows, metric="gex")

    assert norms[7150] > 0
    assert norms[7175] > norms[7150]
    assert norms[7200] == 1


def test_color_norms_are_zero_for_all_zero_values() -> None:
    assert color_norms_by_strike([_row(7150, 0), _row(7175, 0)], metric="gex") == {7150: 0, 7175: 0}


def test_market_date_uses_new_york_date_near_utc_midnight() -> None:
    assert market_date_new_york("2026-04-29T01:30:00Z") == "2026-04-28"


def test_five_minute_bucket_start_floors_in_utc() -> None:
    assert five_minute_bucket_start("2026-04-28T14:07:44Z") == "2026-04-28T14:05:00Z"
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_nodes.py -q
```

Expected: fail with `ModuleNotFoundError` for `gammascope_api.heatmap.nodes` or `normalization`.

- [ ] **Step 3: Implement node and normalization modules**

Create `apps/api/gammascope_api/heatmap/nodes.py`:

```python
from __future__ import annotations

from typing import Literal

from gammascope_api.heatmap.exposure import StrikeExposure
from gammascope_api.heatmap.normalization import percentile


HeatmapMetric = Literal["gex", "vex"]
NodeValue = dict[str, float] | None


def derive_nodes(rows: list[StrikeExposure], *, spot: float, metric: HeatmapMetric) -> dict[str, NodeValue]:
    if not rows:
        return {
            "king": None,
            "positiveKing": None,
            "negativeKing": None,
            "aboveWall": None,
            "belowWall": None,
        }

    values = [(row, _metric_value(row, metric)) for row in rows]
    abs_threshold = percentile([abs(value) for _, value in values], 80)
    above_candidates = [(row, value) for row, value in values if row.strike > spot and abs(value) >= abs_threshold]
    below_candidates = [(row, value) for row, value in values if row.strike < spot and abs(value) >= abs_threshold]
    positive_candidates = [(row, value) for row, value in values if value > 0]
    negative_candidates = [(row, value) for row, value in values if value < 0]

    king_row, king_value = max(values, key=lambda item: abs(item[1]))

    return {
        "king": _node(king_row, king_value),
        "positiveKing": _node(*max(positive_candidates, key=lambda item: item[1])) if positive_candidates else None,
        "negativeKing": _node(*min(negative_candidates, key=lambda item: item[1])) if negative_candidates else None,
        "aboveWall": _node(*min(above_candidates, key=lambda item: item[0].strike - spot)) if above_candidates else None,
        "belowWall": _node(*min(below_candidates, key=lambda item: spot - item[0].strike)) if below_candidates else None,
    }


def _metric_value(row: StrikeExposure, metric: HeatmapMetric) -> float:
    return row.gex if metric == "gex" else row.vex


def _node(row: StrikeExposure, value: float) -> dict[str, float]:
    return {"strike": row.strike, "value": value}
```

Create `apps/api/gammascope_api/heatmap/normalization.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from math import floor, sqrt
from typing import Literal
from zoneinfo import ZoneInfo

from gammascope_api.heatmap.exposure import StrikeExposure


NEW_YORK = ZoneInfo("America/New_York")
HeatmapMetric = Literal["gex", "vex"]


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * pct / 100
    lower = floor(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def color_norms_by_strike(rows: list[StrikeExposure], *, metric: HeatmapMetric) -> dict[float, float]:
    values = {row.strike: abs(_metric_value(row, metric)) for row in rows}
    scale_base = percentile(list(values.values()), 95)
    if scale_base <= 0:
        return {strike: 0.0 for strike in values}
    return {strike: min(1.0, sqrt(value / scale_base)) for strike, value in values.items()}


def market_date_new_york(value: str) -> str:
    return _parse_datetime(value).astimezone(NEW_YORK).date().isoformat()


def five_minute_bucket_start(value: str) -> str:
    parsed = _parse_datetime(value).astimezone(UTC)
    floored_minute = parsed.minute - (parsed.minute % 5)
    bucket = parsed.replace(minute=floored_minute, second=0, microsecond=0)
    return bucket.isoformat().replace("+00:00", "Z")


def _metric_value(row: StrikeExposure, metric: HeatmapMetric) -> float:
    return row.gex if metric == "gex" else row.vex


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_nodes.py -q
```

Expected: all tests in `test_heatmap_nodes.py` pass.

- [ ] **Step 5: Run Task 1 and Task 2 tests together**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_exposure.py apps/api/tests/test_heatmap_nodes.py -q
```

Expected: both heatmap calculation test files pass.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add apps/api/gammascope_api/heatmap/nodes.py apps/api/gammascope_api/heatmap/normalization.py apps/api/tests/test_heatmap_nodes.py
git commit -m "feat: add heatmap node normalization"
```

## Task 3: Heatmap Repository And 09:25 OI Baseline Storage

**Files:**

- Create: `apps/api/gammascope_api/heatmap/repository.py`
- Create: `apps/api/gammascope_api/heatmap/dependencies.py`
- Create: `apps/api/tests/test_heatmap_repository.py`

- [ ] **Step 1: Write failing tests for in-memory repository behavior and SQL schema text**

Create `apps/api/tests/test_heatmap_repository.py`:

```python
from __future__ import annotations

from gammascope_api.heatmap.repository import (
    HEATMAP_SCHEMA_SQL,
    HeatmapOiBaselineRecord,
    InMemoryHeatmapRepository,
)


def test_in_memory_repository_locks_first_post_925_baseline_per_contract() -> None:
    repository = InMemoryHeatmapRepository()
    early = HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
        contract_id="SPX-2026-04-28-C-7200",
        right="call",
        strike=7200,
        open_interest=100,
        captured_at="2026-04-28T13:24:59Z",
        source_snapshot_time="2026-04-28T13:24:59Z",
    )
    locked = HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
        contract_id="SPX-2026-04-28-C-7200",
        right="call",
        strike=7200,
        open_interest=125,
        captured_at="2026-04-28T13:25:01Z",
        source_snapshot_time="2026-04-28T13:25:01Z",
    )
    later = HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
        contract_id="SPX-2026-04-28-C-7200",
        right="call",
        strike=7200,
        open_interest=300,
        captured_at="2026-04-28T14:30:00Z",
        source_snapshot_time="2026-04-28T14:30:00Z",
    )

    repository.upsert_oi_baseline([early])
    assert repository.oi_baseline(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
    )["SPX-2026-04-28-C-7200"].open_interest == 100

    repository.upsert_oi_baseline([locked])
    repository.upsert_oi_baseline([later])

    baseline = repository.oi_baseline(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
    )
    assert baseline["SPX-2026-04-28-C-7200"].open_interest == 125


def test_in_memory_repository_upserts_snapshot_and_bucket() -> None:
    repository = InMemoryHeatmapRepository()
    payload = {
        "sessionId": "moomoo-spx-0dte-live",
        "symbol": "SPX",
        "tradingClass": "SPXW",
        "expirationDate": "2026-04-28",
        "spot": 7173.91,
        "positionMode": "oi_proxy",
        "lastSyncedAt": "2026-04-28T14:07:44Z",
        "oiBaselineStatus": "locked",
        "oiBaselineCapturedAt": "2026-04-28T13:25:01Z",
        "rows": [
            {
                "strike": 7200,
                "gex": 100,
                "vex": 20,
                "callGex": 100,
                "putGex": 0,
                "callVex": 20,
                "putVex": 0,
                "colorNormGex": 1,
                "colorNormVex": 1,
                "tags": [],
            }
        ],
    }

    first = repository.upsert_heatmap_snapshot(payload)
    second = repository.upsert_heatmap_snapshot(payload)

    assert first["heatmap_snapshot_id"] == second["heatmap_snapshot_id"]
    assert repository.latest_bucket(
        session_id="moomoo-spx-0dte-live",
        bucket_start="2026-04-28T14:05:00Z",
        position_mode="oi_proxy",
    )["payload"]["lastSyncedAt"] == "2026-04-28T14:07:44Z"


def test_schema_sql_contains_required_heatmap_tables() -> None:
    assert "CREATE TABLE IF NOT EXISTS heatmap_oi_baselines" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_snapshots" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_cells" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_bucket_5m" in HEATMAP_SCHEMA_SQL
    assert "UNIQUE (session_id, source_snapshot_time, position_mode)" in HEATMAP_SCHEMA_SQL
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_repository.py -q
```

Expected: fail with `ModuleNotFoundError` or import errors for `gammascope_api.heatmap.repository`.

- [ ] **Step 3: Implement repository protocol, in-memory repository, Postgres schema, and dependencies**

Create `apps/api/gammascope_api/heatmap/repository.py` with:

```python
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime, time
from typing import Any, Protocol

from gammascope_api.heatmap.normalization import five_minute_bucket_start


OI_BASELINE_LOCK_TIME_NY = time(hour=9, minute=25)

HEATMAP_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS heatmap_oi_baselines (
  baseline_id BIGSERIAL PRIMARY KEY,
  market_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  trading_class TEXT NOT NULL,
  expiration_date DATE NOT NULL,
  contract_id TEXT NOT NULL,
  right TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  open_interest INTEGER NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  source_snapshot_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_date, symbol, trading_class, expiration_date, contract_id)
);
CREATE TABLE IF NOT EXISTS heatmap_snapshots (
  heatmap_snapshot_id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_snapshot_time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  trading_class TEXT NOT NULL,
  expiration_date DATE NOT NULL,
  spot NUMERIC NOT NULL,
  position_mode TEXT NOT NULL,
  oi_baseline_status TEXT NOT NULL,
  oi_baseline_captured_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, source_snapshot_time, position_mode)
);
CREATE TABLE IF NOT EXISTS heatmap_cells (
  heatmap_cell_id BIGSERIAL PRIMARY KEY,
  heatmap_snapshot_id BIGINT NOT NULL REFERENCES heatmap_snapshots(heatmap_snapshot_id) ON DELETE CASCADE,
  strike NUMERIC NOT NULL,
  gex NUMERIC NOT NULL,
  vex NUMERIC NOT NULL,
  call_gex NUMERIC NOT NULL,
  put_gex NUMERIC NOT NULL,
  call_vex NUMERIC NOT NULL,
  put_vex NUMERIC NOT NULL,
  color_norm_gex NUMERIC NOT NULL,
  color_norm_vex NUMERIC NOT NULL,
  tags JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS heatmap_bucket_5m (
  bucket_id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  trading_class TEXT NOT NULL,
  expiration_date DATE NOT NULL,
  position_mode TEXT NOT NULL,
  latest_heatmap_snapshot_id BIGINT NOT NULL REFERENCES heatmap_snapshots(heatmap_snapshot_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, bucket_start, position_mode)
);
CREATE INDEX IF NOT EXISTS heatmap_snapshots_session_time_idx
ON heatmap_snapshots (session_id, source_snapshot_time DESC);
CREATE INDEX IF NOT EXISTS heatmap_cells_snapshot_strike_idx
ON heatmap_cells (heatmap_snapshot_id, strike);
CREATE INDEX IF NOT EXISTS heatmap_bucket_5m_session_bucket_idx
ON heatmap_bucket_5m (session_id, bucket_start DESC, position_mode);
CREATE INDEX IF NOT EXISTS heatmap_oi_baselines_market_expiry_strike_idx
ON heatmap_oi_baselines (market_date, expiration_date, strike);
"""


@dataclass(frozen=True)
class HeatmapOiBaselineRecord:
    market_date: str
    symbol: str
    trading_class: str
    expiration_date: str
    contract_id: str
    right: str
    strike: float
    open_interest: int
    captured_at: str
    source_snapshot_time: str


class HeatmapRepository(Protocol):
    def ensure_schema(self) -> None:
        ...

    def oi_baseline(
        self,
        *,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> dict[str, HeatmapOiBaselineRecord]:
        ...

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> None:
        ...

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...


class InMemoryHeatmapRepository:
    def __init__(self) -> None:
        self._baselines: dict[tuple[str, str, str, str, str], HeatmapOiBaselineRecord] = {}
        self._snapshots: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._next_snapshot_id = 1

    def ensure_schema(self) -> None:
        return None

    def oi_baseline(
        self,
        *,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> dict[str, HeatmapOiBaselineRecord]:
        result: dict[str, HeatmapOiBaselineRecord] = {}
        for key, record in self._baselines.items():
            key_market_date, key_symbol, key_trading_class, key_expiration_date, contract_id = key
            if (
                key_market_date == market_date
                and key_symbol == symbol
                and key_trading_class == trading_class
                and key_expiration_date == expiration_date
            ):
                result[contract_id] = record
        return result

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> None:
        for record in records:
            key = (
                record.market_date,
                record.symbol,
                record.trading_class,
                record.expiration_date,
                record.contract_id,
            )
            existing = self._baselines.get(key)
            if existing is None or _record_is_better_baseline(record, existing):
                self._baselines[key] = record

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = (str(payload["sessionId"]), str(payload["lastSyncedAt"]), str(payload["positionMode"]))
        existing = self._snapshots.get(key)
        if existing is None:
            existing = {
                "heatmap_snapshot_id": self._next_snapshot_id,
                "session_id": payload["sessionId"],
                "source_snapshot_time": payload["lastSyncedAt"],
                "row_count": len(payload.get("rows", [])),
                "payload": deepcopy(payload),
            }
            self._next_snapshot_id += 1
            self._snapshots[key] = existing
        else:
            existing["payload"] = deepcopy(payload)
            existing["row_count"] = len(payload.get("rows", []))

        bucket_start = five_minute_bucket_start(str(payload["lastSyncedAt"]))
        self._buckets[(str(payload["sessionId"]), bucket_start, str(payload["positionMode"]))] = {
            "bucket_start": bucket_start,
            "latest_heatmap_snapshot_id": existing["heatmap_snapshot_id"],
            "payload": deepcopy(payload),
        }
        return deepcopy(existing)

    def latest_bucket(self, *, session_id: str, bucket_start: str, position_mode: str) -> dict[str, Any]:
        return deepcopy(self._buckets[(session_id, bucket_start, position_mode)])
```

Append the remaining functions and Postgres class in the same file:

```python
class PostgresHeatmapRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def ensure_schema(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for statement in [part.strip() for part in HEATMAP_SCHEMA_SQL.split(";") if part.strip()]:
                    cursor.execute(statement)

    def oi_baseline(
        self,
        *,
        market_date: str,
        symbol: str,
        trading_class: str,
        expiration_date: str,
    ) -> dict[str, HeatmapOiBaselineRecord]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT market_date, symbol, trading_class, expiration_date, contract_id, right, strike,
                           open_interest, captured_at, source_snapshot_time
                    FROM heatmap_oi_baselines
                    WHERE market_date = %s
                      AND symbol = %s
                      AND trading_class = %s
                      AND expiration_date = %s
                    """,
                    (market_date, symbol, trading_class, expiration_date),
                )
                records = cursor.fetchall()
        return {_baseline_from_record(record).contract_id: _baseline_from_record(record) for record in records}

    def upsert_oi_baseline(self, records: list[HeatmapOiBaselineRecord]) -> None:
        if not records:
            return None
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for record in records:
                    cursor.execute(
                        """
                        INSERT INTO heatmap_oi_baselines (
                          market_date, symbol, trading_class, expiration_date, contract_id, right,
                          strike, open_interest, captured_at, source_snapshot_time
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (market_date, symbol, trading_class, expiration_date, contract_id)
                        DO UPDATE SET
                          right = EXCLUDED.right,
                          strike = EXCLUDED.strike,
                          open_interest = EXCLUDED.open_interest,
                          captured_at = EXCLUDED.captured_at,
                          source_snapshot_time = EXCLUDED.source_snapshot_time
                        WHERE heatmap_oi_baselines.captured_at < %s
                        """,
                        (
                            record.market_date,
                            record.symbol,
                            record.trading_class,
                            record.expiration_date,
                            record.contract_id,
                            record.right,
                            record.strike,
                            record.open_interest,
                            _parse_datetime(record.captured_at),
                            _parse_datetime(record.source_snapshot_time),
                            _baseline_lock_utc(record.market_date),
                        ),
                    )

    def upsert_heatmap_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO heatmap_snapshots (
                      session_id, source_snapshot_time, symbol, trading_class, expiration_date, spot,
                      position_mode, oi_baseline_status, oi_baseline_captured_at, payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, source_snapshot_time, position_mode)
                    DO UPDATE SET
                      spot = EXCLUDED.spot,
                      oi_baseline_status = EXCLUDED.oi_baseline_status,
                      oi_baseline_captured_at = EXCLUDED.oi_baseline_captured_at,
                      payload = EXCLUDED.payload
                    RETURNING heatmap_snapshot_id, session_id, source_snapshot_time
                    """,
                    (
                        payload["sessionId"],
                        _parse_datetime(str(payload["lastSyncedAt"])),
                        payload["symbol"],
                        payload["tradingClass"],
                        payload["expirationDate"],
                        payload["spot"],
                        payload["positionMode"],
                        payload["oiBaselineStatus"],
                        _parse_optional_datetime(payload.get("oiBaselineCapturedAt")),
                        _jsonb(payload),
                    ),
                )
                record = cursor.fetchone()
                snapshot_id = int(record[0])
                cursor.execute("DELETE FROM heatmap_cells WHERE heatmap_snapshot_id = %s", (snapshot_id,))
                for row in payload.get("rows", []):
                    cursor.execute(
                        """
                        INSERT INTO heatmap_cells (
                          heatmap_snapshot_id, strike, gex, vex, call_gex, put_gex,
                          call_vex, put_vex, color_norm_gex, color_norm_vex, tags
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            snapshot_id,
                            row["strike"],
                            row["gex"],
                            row["vex"],
                            row["callGex"],
                            row["putGex"],
                            row["callVex"],
                            row["putVex"],
                            row["colorNormGex"],
                            row["colorNormVex"],
                            _jsonb(row.get("tags", [])),
                        ),
                    )
                bucket_start = five_minute_bucket_start(str(payload["lastSyncedAt"]))
                cursor.execute(
                    """
                    INSERT INTO heatmap_bucket_5m (
                      session_id, bucket_start, symbol, trading_class, expiration_date,
                      position_mode, latest_heatmap_snapshot_id, payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, bucket_start, position_mode)
                    DO UPDATE SET
                      latest_heatmap_snapshot_id = EXCLUDED.latest_heatmap_snapshot_id,
                      payload = EXCLUDED.payload,
                      updated_at = NOW()
                    """,
                    (
                        payload["sessionId"],
                        _parse_datetime(bucket_start),
                        payload["symbol"],
                        payload["tradingClass"],
                        payload["expirationDate"],
                        payload["positionMode"],
                        snapshot_id,
                        _jsonb(payload),
                    ),
                )
        return {
            "heatmap_snapshot_id": snapshot_id,
            "session_id": payload["sessionId"],
            "source_snapshot_time": payload["lastSyncedAt"],
            "row_count": len(payload.get("rows", [])),
            "payload": deepcopy(payload),
        }

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, connect_timeout=2)


def _record_is_better_baseline(next_record: HeatmapOiBaselineRecord, existing: HeatmapOiBaselineRecord) -> bool:
    next_time = _parse_datetime(next_record.captured_at)
    existing_time = _parse_datetime(existing.captured_at)
    lock_time = _baseline_lock_utc(next_record.market_date)
    if existing_time >= lock_time:
        return False
    return next_time >= existing_time


def _baseline_lock_utc(market_date: str) -> datetime:
    from zoneinfo import ZoneInfo

    local = datetime.fromisoformat(f"{market_date}T09:25:00").replace(tzinfo=ZoneInfo("America/New_York"))
    return local.astimezone(UTC)


def _baseline_from_record(record: tuple[Any, ...]) -> HeatmapOiBaselineRecord:
    return HeatmapOiBaselineRecord(
        market_date=str(record[0]),
        symbol=str(record[1]),
        trading_class=str(record[2]),
        expiration_date=str(record[3]),
        contract_id=str(record[4]),
        right=str(record[5]),
        strike=float(record[6]),
        open_interest=int(record[7]),
        captured_at=_format_datetime(record[8]),
        source_snapshot_time=_format_datetime(record[9]),
    )


def _jsonb(payload: Any) -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb(payload)


def _parse_optional_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    return _parse_datetime(str(value))


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
```

Create `apps/api/gammascope_api/heatmap/dependencies.py`:

```python
from __future__ import annotations

from functools import lru_cache

from gammascope_api.heatmap.repository import HeatmapRepository, PostgresHeatmapRepository
from gammascope_api.replay.dependencies import database_url


_repository_override: HeatmapRepository | None = None


def get_heatmap_repository() -> HeatmapRepository:
    if _repository_override is not None:
        return _repository_override
    return _default_heatmap_repository(database_url())


def set_heatmap_repository_override(repository: HeatmapRepository) -> None:
    global _repository_override
    _repository_override = repository


def reset_heatmap_repository_override() -> None:
    global _repository_override
    _repository_override = None
    _default_heatmap_repository.cache_clear()


@lru_cache(maxsize=1)
def _default_heatmap_repository(database_url_value: str) -> HeatmapRepository:
    return PostgresHeatmapRepository(database_url_value)
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_repository.py -q
```

Expected: repository tests pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/api/gammascope_api/heatmap/repository.py apps/api/gammascope_api/heatmap/dependencies.py apps/api/tests/test_heatmap_repository.py
git commit -m "feat: persist heatmap snapshots"
```

## Task 4: Heatmap Service And API Route

**Files:**

- Create: `apps/api/gammascope_api/heatmap/service.py`
- Create: `apps/api/gammascope_api/routes/heatmap.py`
- Modify: `apps/api/gammascope_api/main.py`
- Create: `apps/api/tests/test_heatmap_service.py`
- Create: `apps/api/tests/test_heatmap_route.py`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/tests/test_heatmap_service.py`:

```python
from __future__ import annotations

from gammascope_api.heatmap.repository import InMemoryHeatmapRepository
from gammascope_api.heatmap.service import build_heatmap_payload


def _snapshot(snapshot_time: str = "2026-04-28T14:00:44Z") -> dict:
    return {
        "schema_version": "1.0.0",
        "session_id": "moomoo-spx-0dte-live",
        "mode": "live",
        "symbol": "SPX",
        "expiry": "2026-04-28",
        "snapshot_time": snapshot_time,
        "spot": 7173.91,
        "forward": 7174.12,
        "discount_factor": 1,
        "risk_free_rate": 0.05,
        "dividend_yield": 0.01,
        "source_status": "connected",
        "freshness_ms": 250,
        "coverage_status": "partial",
        "scenario_params": None,
        "rows": [
            {
                "contract_id": "SPX-2026-04-28-C-7200",
                "right": "call",
                "strike": 7200,
                "bid": 1,
                "ask": 1.2,
                "mid": 1.1,
                "open_interest": 10,
                "custom_iv": 0.18,
                "custom_gamma": 0.002,
                "custom_vanna": 0.03,
                "ibkr_iv": 0.18,
                "ibkr_gamma": 0.002,
                "ibkr_vanna": None,
                "iv_diff": 0,
                "gamma_diff": 0,
                "calc_status": "ok",
                "comparison_status": "ok",
            },
            {
                "contract_id": "SPX-2026-04-28-P-7200",
                "right": "put",
                "strike": 7200,
                "bid": 1,
                "ask": 1.2,
                "mid": 1.1,
                "open_interest": 4,
                "custom_iv": 0.18,
                "custom_gamma": 0.003,
                "custom_vanna": -0.02,
                "ibkr_iv": 0.18,
                "ibkr_gamma": 0.003,
                "ibkr_vanna": None,
                "iv_diff": 0,
                "gamma_diff": 0,
                "calc_status": "ok",
                "comparison_status": "ok",
            },
        ],
    }


def test_build_heatmap_payload_returns_gex_rows_nodes_and_persists() -> None:
    repository = InMemoryHeatmapRepository()

    payload = build_heatmap_payload(_snapshot(), metric="gex", repository=repository)

    assert payload["symbol"] == "SPX"
    assert payload["tradingClass"] == "SPXW"
    assert payload["dte"] == 0
    assert payload["metric"] == "gex"
    assert payload["positionMode"] == "oi_proxy"
    assert payload["oiBaselineStatus"] == "locked"
    assert payload["persistenceStatus"] == "persisted"
    assert payload["lastSyncedAt"] == "2026-04-28T14:00:44Z"
    assert payload["rows"][0]["strike"] == 7200
    assert payload["rows"][0]["formattedValue"].startswith("$") or payload["rows"][0]["formattedValue"].startswith("-$")
    assert payload["nodes"]["king"]["strike"] == 7200


def test_build_heatmap_payload_marks_provisional_baseline_before_925() -> None:
    repository = InMemoryHeatmapRepository()

    payload = build_heatmap_payload(_snapshot("2026-04-28T13:24:00Z"), metric="vex", repository=repository)

    assert payload["metric"] == "vex"
    assert payload["oiBaselineStatus"] == "provisional"
    assert payload["oiBaselineCapturedAt"] is None


def test_build_heatmap_payload_reports_unavailable_persistence_when_repository_fails() -> None:
    class FailingRepository(InMemoryHeatmapRepository):
        def upsert_heatmap_snapshot(self, payload: dict) -> dict:
            raise RuntimeError("database down")

    payload = build_heatmap_payload(_snapshot(), metric="gex", repository=FailingRepository())

    assert payload["persistenceStatus"] == "unavailable"
    assert payload["rows"]
```

- [ ] **Step 2: Run service tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_service.py -q
```

Expected: fail with `ModuleNotFoundError` or import error for `gammascope_api.heatmap.service`.

- [ ] **Step 3: Implement heatmap service**

Create `apps/api/gammascope_api/heatmap/service.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from gammascope_api.heatmap.exposure import HeatmapContractInput, aggregate_exposure_by_strike, format_money
from gammascope_api.heatmap.nodes import derive_nodes
from gammascope_api.heatmap.normalization import color_norms_by_strike, market_date_new_york
from gammascope_api.heatmap.repository import HeatmapOiBaselineRecord, HeatmapRepository


HeatmapMetric = Literal["gex", "vex"]
POSITION_MODE = "oi_proxy"
TRADING_CLASS = "SPXW"


def build_heatmap_payload(snapshot: dict[str, Any], *, metric: HeatmapMetric, repository: HeatmapRepository) -> dict[str, Any]:
    market_date = market_date_new_york(str(snapshot["snapshot_time"]))
    baseline = _ensure_baseline(snapshot, repository=repository, market_date=market_date)
    baseline_by_contract = {contract_id: record.open_interest for contract_id, record in baseline.items()}
    rows = aggregate_exposure_by_strike(_contract_inputs(snapshot, baseline_by_contract), spot=float(snapshot["spot"]))
    gex_norms = color_norms_by_strike(rows, metric="gex")
    vex_norms = color_norms_by_strike(rows, metric="vex")
    active_norms = gex_norms if metric == "gex" else vex_norms
    nodes = derive_nodes(rows, spot=float(snapshot["spot"]), metric=metric)
    row_payloads = []
    for row in rows:
        value = row.gex if metric == "gex" else row.vex
        tags = list(row.tags)
        _append_node_tags(tags, row.strike, nodes)
        row_payloads.append(
            {
                "strike": row.strike,
                "value": value,
                "formattedValue": format_money(value),
                "callValue": row.call_gex if metric == "gex" else row.call_vex,
                "putValue": row.put_gex if metric == "gex" else row.put_vex,
                "colorNorm": active_norms.get(row.strike, 0),
                "gex": row.gex,
                "vex": row.vex,
                "callGex": row.call_gex,
                "putGex": row.put_gex,
                "callVex": row.call_vex,
                "putVex": row.put_vex,
                "colorNormGex": gex_norms.get(row.strike, 0),
                "colorNormVex": vex_norms.get(row.strike, 0),
                "tags": tags,
            }
        )

    baseline_status = _baseline_status(str(snapshot["snapshot_time"]))
    baseline_captured_at = _baseline_captured_at(baseline.values()) if baseline_status == "locked" else None
    payload = {
        "sessionId": snapshot["session_id"],
        "symbol": "SPX",
        "tradingClass": TRADING_CLASS,
        "dte": 0 if market_date == snapshot["expiry"] else None,
        "expirationDate": snapshot["expiry"],
        "spot": snapshot["spot"],
        "metric": metric,
        "positionMode": POSITION_MODE,
        "oiBaselineStatus": baseline_status,
        "oiBaselineCapturedAt": baseline_captured_at,
        "lastSyncedAt": snapshot["snapshot_time"],
        "isLive": snapshot.get("mode") == "live" and snapshot.get("source_status") == "connected",
        "isStale": int(snapshot.get("freshness_ms") or 0) > 5_000,
        "persistenceStatus": "pending",
        "rows": row_payloads,
        "nodes": nodes,
    }
    try:
        repository.upsert_heatmap_snapshot(payload)
        payload["persistenceStatus"] = "persisted"
    except Exception:
        payload["persistenceStatus"] = "unavailable"
    return payload
```

Append helper functions in the same file:

```python
def _ensure_baseline(
    snapshot: dict[str, Any],
    *,
    repository: HeatmapRepository,
    market_date: str,
) -> dict[str, HeatmapOiBaselineRecord]:
    existing = repository.oi_baseline(
        market_date=market_date,
        symbol="SPX",
        trading_class=TRADING_CLASS,
        expiration_date=str(snapshot["expiry"]),
    )
    records = []
    for row in snapshot.get("rows", []):
        open_interest = row.get("open_interest")
        if open_interest is None:
            continue
        records.append(
            HeatmapOiBaselineRecord(
                market_date=market_date,
                symbol="SPX",
                trading_class=TRADING_CLASS,
                expiration_date=str(snapshot["expiry"]),
                contract_id=str(row["contract_id"]),
                right=str(row["right"]),
                strike=float(row["strike"]),
                open_interest=int(open_interest),
                captured_at=str(snapshot["snapshot_time"]),
                source_snapshot_time=str(snapshot["snapshot_time"]),
            )
        )
    repository.upsert_oi_baseline(records)
    refreshed = repository.oi_baseline(
        market_date=market_date,
        symbol="SPX",
        trading_class=TRADING_CLASS,
        expiration_date=str(snapshot["expiry"]),
    )
    return refreshed or existing


def _contract_inputs(snapshot: dict[str, Any], baseline_by_contract: dict[str, int]) -> list[HeatmapContractInput]:
    return [
        HeatmapContractInput(
            contract_id=str(row["contract_id"]),
            right=str(row["right"]),
            strike=float(row["strike"]),
            baseline_open_interest=baseline_by_contract.get(str(row["contract_id"])),
            custom_gamma=row.get("custom_gamma"),
            custom_vanna=row.get("custom_vanna"),
        )
        for row in snapshot.get("rows", [])
    ]


def _baseline_status(snapshot_time: str) -> str:
    parsed = _parse_datetime(snapshot_time)
    from zoneinfo import ZoneInfo

    market_time = parsed.astimezone(ZoneInfo("America/New_York"))
    lock_time = market_time.replace(hour=9, minute=25, second=0, microsecond=0)
    return "locked" if market_time >= lock_time else "provisional"


def _baseline_captured_at(records: Any) -> str | None:
    captured = [record.captured_at for record in records]
    return min(captured) if captured else None


def _append_node_tags(tags: list[str], strike: float, nodes: dict[str, dict[str, float] | None]) -> None:
    tag_by_node = {
        "king": "king",
        "aboveWall": "above_wall",
        "belowWall": "below_wall",
    }
    for node_key, tag in tag_by_node.items():
        node = nodes.get(node_key)
        if node is not None and node["strike"] == strike and tag not in tags:
            tags.append(tag)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
```

- [ ] **Step 4: Run service tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_service.py -q
```

Expected: service tests pass.

- [ ] **Step 5: Write failing route tests**

Create `apps/api/tests/test_heatmap_route.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from gammascope_api.heatmap.dependencies import reset_heatmap_repository_override, set_heatmap_repository_override
from gammascope_api.heatmap.repository import InMemoryHeatmapRepository
from gammascope_api.ingestion.collector_state import collector_state
from gammascope_api.main import app


def setup_function() -> None:
    collector_state.clear()
    set_heatmap_repository_override(InMemoryHeatmapRepository())


def teardown_function() -> None:
    collector_state.clear()
    reset_heatmap_repository_override()


def test_latest_heatmap_route_returns_gex_payload_from_collector_state() -> None:
    _ingest_live_cycle()
    client = TestClient(app)

    response = client.get("/api/spx/0dte/heatmap/latest?metric=gex")

    assert response.status_code == 200
    payload = response.json()
    assert payload["metric"] == "gex"
    assert payload["symbol"] == "SPX"
    assert payload["tradingClass"] == "SPXW"
    assert payload["rows"]


def test_latest_heatmap_route_rejects_invalid_metric() -> None:
    client = TestClient(app)

    response = client.get("/api/spx/0dte/heatmap/latest?metric=delta")

    assert response.status_code == 422
```

Append helper in the same test file:

```python
def _ingest_live_cycle() -> None:
    events = [
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "collector_id": "local-moomoo",
            "status": "connected",
            "ibkr_account_mode": "unknown",
            "message": "Moomoo compatibility snapshot emitted",
            "event_time": "2026-04-28T14:00:44Z",
            "received_time": "2026-04-28T14:00:44Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "moomoo-spx-0dte-live",
            "symbol": "SPX",
            "spot": 7173.91,
            "bid": None,
            "ask": None,
            "last": 7173.91,
            "mark": 7173.91,
            "event_time": "2026-04-28T14:00:44Z",
            "quote_status": "valid",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "moomoo-spx-0dte-live",
            "contract_id": "SPX-2026-04-28-C-7200",
            "ibkr_con_id": 1,
            "symbol": "SPX",
            "expiry": "2026-04-28",
            "right": "call",
            "strike": 7200,
            "multiplier": 100,
            "exchange": "CBOE",
            "currency": "USD",
            "event_time": "2026-04-28T14:00:44Z",
        },
        {
            "schema_version": "1.0.0",
            "source": "ibkr",
            "session_id": "moomoo-spx-0dte-live",
            "contract_id": "SPX-2026-04-28-C-7200",
            "bid": 1,
            "ask": 1.2,
            "last": 1.1,
            "bid_size": 1,
            "ask_size": 1,
            "volume": 20,
            "open_interest": 10,
            "ibkr_iv": 0.18,
            "ibkr_delta": 0.5,
            "ibkr_gamma": 0.002,
            "ibkr_vega": 0.1,
            "ibkr_theta": -0.1,
            "event_time": "2026-04-28T14:00:44Z",
            "quote_status": "valid",
        },
    ]
    from gammascope_api.contracts.generated.collector_events import CollectorEvents

    for event in events:
        collector_state.ingest(CollectorEvents.model_validate(event))
```

- [ ] **Step 6: Run route tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_route.py -q
```

Expected: fail with `404 Not Found` for `/api/spx/0dte/heatmap/latest`.

- [ ] **Step 7: Implement route and include router**

Create `apps/api/gammascope_api/routes/heatmap.py`:

```python
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query

from gammascope_api.auth import can_read_live_state
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.heatmap.dependencies import get_heatmap_repository
from gammascope_api.heatmap.service import build_heatmap_payload
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot


router = APIRouter()
HeatmapMetric = Literal["gex", "vex"]


@router.get("/api/spx/0dte/heatmap/latest")
def get_latest_heatmap(
    metric: HeatmapMetric = Query(default="gex"),
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict:
    snapshot = None
    if can_read_live_state(x_gammascope_admin_token):
        snapshot = build_live_snapshot(cached_or_memory_collector_state())
    if snapshot is None:
        snapshot = load_json_fixture("analytics-snapshot.seed.json")
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No SPX 0DTE snapshot is available")
    return build_heatmap_payload(snapshot, metric=metric, repository=get_heatmap_repository())
```

Modify `apps/api/gammascope_api/main.py` to import and include `heatmap`:

```python
from gammascope_api.routes import admin, collector, heatmap, replay, replay_imports, scenario, snapshot, status, stream, views
```

and add:

```python
app.include_router(heatmap.router)
```

near the other router includes.

- [ ] **Step 8: Run service and route tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_service.py apps/api/tests/test_heatmap_route.py -q
```

Expected: service and route tests pass.

- [ ] **Step 9: Run all backend heatmap tests**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_*.py -q
```

Expected: all heatmap backend tests pass.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git add apps/api/gammascope_api/heatmap/service.py apps/api/gammascope_api/routes/heatmap.py apps/api/gammascope_api/main.py apps/api/tests/test_heatmap_service.py apps/api/tests/test_heatmap_route.py
git commit -m "feat: serve latest heatmap api"
```

## Task 5: Web Heatmap Client And Proxy

**Files:**

- Create: `apps/web/lib/clientHeatmapSource.ts`
- Create: `apps/web/lib/heatmapFormat.ts`
- Create: `apps/web/app/api/spx/0dte/heatmap/latest/route.ts`
- Create: `apps/web/tests/clientHeatmapSource.test.ts`
- Create: `apps/web/tests/heatmapFormat.test.ts`
- Create: `apps/web/tests/heatmapRoute.test.ts`

- [ ] **Step 1: Write failing tests for heatmap source and formatting**

Create `apps/web/tests/clientHeatmapSource.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { isHeatmapPayload, loadClientHeatmap } from "../lib/clientHeatmapSource";

const payload = {
  sessionId: "moomoo-spx-0dte-live",
  symbol: "SPX",
  tradingClass: "SPXW",
  dte: 0,
  expirationDate: "2026-04-28",
  spot: 7173.91,
  metric: "gex",
  positionMode: "oi_proxy",
  oiBaselineStatus: "locked",
  oiBaselineCapturedAt: "2026-04-28T13:25:02Z",
  lastSyncedAt: "2026-04-28T14:00:44Z",
  isLive: true,
  isStale: false,
  persistenceStatus: "persisted",
  rows: [{ strike: 7200, value: 100, formattedValue: "$100", callValue: 100, putValue: 0, colorNorm: 1, tags: ["king"] }],
  nodes: { king: { strike: 7200, value: 100 }, positiveKing: null, negativeKing: null, aboveWall: null, belowWall: null }
};

describe("clientHeatmapSource", () => {
  it("accepts valid heatmap payloads", () => {
    expect(isHeatmapPayload(payload)).toBe(true);
  });

  it("rejects malformed heatmap payloads", () => {
    expect(isHeatmapPayload({ ...payload, rows: "bad" })).toBe(false);
    expect(isHeatmapPayload({ ...payload, metric: "delta" })).toBe(false);
  });

  it("loads selected metric from client proxy", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));

    const result = await loadClientHeatmap("gex", { fetcher });

    expect(result).toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/heatmap/latest?metric=gex", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });
});
```

Create `apps/web/tests/heatmapFormat.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { exposureToneClass, formatHeatmapStatus } from "../lib/heatmapFormat";

describe("heatmapFormat", () => {
  it("maps positive and negative values to sign-aware classes", () => {
    expect(exposureToneClass(100, 0.8)).toBe("heatmapCell-positive heatmapCell-intensity-4");
    expect(exposureToneClass(-100, 0.4)).toBe("heatmapCell-negative heatmapCell-intensity-2");
    expect(exposureToneClass(0, 0)).toBe("heatmapCell-neutral heatmapCell-intensity-0");
  });

  it("formats heatmap status labels", () => {
    expect(formatHeatmapStatus({ isLive: true, isStale: false })).toBe("LIVE");
    expect(formatHeatmapStatus({ isLive: true, isStale: true })).toBe("STALE");
    expect(formatHeatmapStatus({ isLive: false, isStale: false })).toBe("DELAYED");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- --run clientHeatmapSource heatmapFormat
```

Expected: fail with missing module errors for `clientHeatmapSource` and `heatmapFormat`.

- [ ] **Step 3: Implement heatmap client and formatting helpers**

Create `apps/web/lib/clientHeatmapSource.ts`:

```typescript
export type HeatmapMetric = "gex" | "vex";
export type OiBaselineStatus = "provisional" | "locked";
export type PersistenceStatus = "pending" | "persisted" | "unavailable";

export interface HeatmapNode {
  strike: number;
  value: number;
}

export interface HeatmapRow {
  strike: number;
  value: number;
  formattedValue: string;
  callValue: number;
  putValue: number;
  colorNorm: number;
  tags: string[];
}

export interface HeatmapPayload {
  sessionId: string;
  symbol: "SPX";
  tradingClass: "SPXW";
  dte: number | null;
  expirationDate: string;
  spot: number;
  metric: HeatmapMetric;
  positionMode: "oi_proxy";
  oiBaselineStatus: OiBaselineStatus;
  oiBaselineCapturedAt: string | null;
  lastSyncedAt: string;
  isLive: boolean;
  isStale: boolean;
  persistenceStatus: PersistenceStatus;
  rows: HeatmapRow[];
  nodes: {
    king: HeatmapNode | null;
    positiveKing: HeatmapNode | null;
    negativeKing: HeatmapNode | null;
    aboveWall: HeatmapNode | null;
    belowWall: HeatmapNode | null;
  };
}

const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";
type HeatmapFetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function loadClientHeatmap(
  metric: HeatmapMetric = "gex",
  options: { fetcher?: HeatmapFetcher } = {}
): Promise<HeatmapPayload | null> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(`${HEATMAP_PATH}?metric=${metric}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return isHeatmapPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function isHeatmapPayload(value: unknown): value is HeatmapPayload {
  if (!isRecord(value)) return false;
  return (
    value.symbol === "SPX" &&
    value.tradingClass === "SPXW" &&
    (value.metric === "gex" || value.metric === "vex") &&
    value.positionMode === "oi_proxy" &&
    (value.oiBaselineStatus === "provisional" || value.oiBaselineStatus === "locked") &&
    typeof value.spot === "number" &&
    typeof value.lastSyncedAt === "string" &&
    typeof value.isLive === "boolean" &&
    typeof value.isStale === "boolean" &&
    Array.isArray(value.rows) &&
    value.rows.every(isHeatmapRow) &&
    isRecord(value.nodes)
  );
}

function isHeatmapRow(value: unknown): value is HeatmapRow {
  return (
    isRecord(value) &&
    typeof value.strike === "number" &&
    typeof value.value === "number" &&
    typeof value.formattedValue === "string" &&
    typeof value.callValue === "number" &&
    typeof value.putValue === "number" &&
    typeof value.colorNorm === "number" &&
    Array.isArray(value.tags)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

Create `apps/web/lib/heatmapFormat.ts`:

```typescript
export function exposureToneClass(value: number, colorNorm: number): string {
  const sign = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  return `heatmapCell-${sign} heatmapCell-intensity-${intensityBucket(colorNorm)}`;
}

export function formatHeatmapStatus(status: { isLive: boolean; isStale: boolean }): string {
  if (status.isStale) {
    return "STALE";
  }
  return status.isLive ? "LIVE" : "DELAYED";
}

export function formatHeatmapTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

function intensityBucket(colorNorm: number): number {
  if (colorNorm <= 0) return 0;
  if (colorNorm < 0.25) return 1;
  if (colorNorm < 0.5) return 2;
  if (colorNorm < 0.75) return 3;
  return 4;
}
```

- [ ] **Step 4: Run client/format tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- --run clientHeatmapSource heatmapFormat
```

Expected: tests pass.

- [ ] **Step 5: Write failing proxy route tests**

Create `apps/web/tests/heatmapRoute.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/spx/0dte/heatmap/latest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("proxies metric query to FastAPI", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { GET } = await import("../app/api/spx/0dte/heatmap/latest/route");

    const response = await GET(new Request("http://localhost/api/spx/0dte/heatmap/latest?metric=vex"));

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/heatmap/latest?metric=vex", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });
});
```

- [ ] **Step 6: Run proxy test to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- --run heatmapRoute
```

Expected: fail because route file is missing.

- [ ] **Step 7: Implement Next.js proxy route**

Create `apps/web/app/api/spx/0dte/heatmap/latest/route.ts`:

```typescript
const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";

export async function GET(request: Request): Promise<Response> {
  const apiBase = process.env.GAMMASCOPE_API_BASE_URL ?? "http://127.0.0.1:8000";
  const requestUrl = new URL(request.url);
  const upstream = `${apiBase}${HEATMAP_PATH}${requestUrl.search}`;

  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" }
    });
  } catch {
    return Response.json({ error: "Heatmap API unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 8: Run all Task 5 tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run clientHeatmapSource heatmapFormat heatmapRoute
```

Expected: all Task 5 tests pass.

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add apps/web/lib/clientHeatmapSource.ts apps/web/lib/heatmapFormat.ts apps/web/app/api/spx/0dte/heatmap/latest/route.ts apps/web/tests/clientHeatmapSource.test.ts apps/web/tests/heatmapFormat.test.ts apps/web/tests/heatmapRoute.test.ts
git commit -m "feat: add heatmap web client"
```

## Task 6: Heatmap UI Components And Page

**Files:**

- Create: `apps/web/components/HeatmapToolbar.tsx`
- Create: `apps/web/components/HeatmapNodePanel.tsx`
- Create: `apps/web/components/ExposureHeatmap.tsx`
- Create: `apps/web/app/heatmap/page.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/app/styles.css`
- Create: `apps/web/tests/ExposureHeatmap.test.tsx`
- Create: `apps/web/tests/HeatmapPage.test.tsx`
- Modify: `apps/web/tests/LiveDashboard.test.tsx`
- Modify: `apps/web/tests/ReplayDashboard.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/tests/ExposureHeatmap.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExposureHeatmap } from "../components/ExposureHeatmap";
import type { HeatmapPayload } from "../lib/clientHeatmapSource";

const payload: HeatmapPayload = {
  sessionId: "moomoo-spx-0dte-live",
  symbol: "SPX",
  tradingClass: "SPXW",
  dte: 0,
  expirationDate: "2026-04-28",
  spot: 7173.91,
  metric: "gex",
  positionMode: "oi_proxy",
  oiBaselineStatus: "locked",
  oiBaselineCapturedAt: "2026-04-28T13:25:02Z",
  lastSyncedAt: "2026-04-28T14:00:44Z",
  isLive: true,
  isStale: false,
  persistenceStatus: "persisted",
  rows: [
    { strike: 7200, value: 7_800_000, formattedValue: "$7.8M", callValue: 7_800_000, putValue: 0, colorNorm: 1, tags: ["above_wall"] },
    { strike: 7175, value: -4_200_000, formattedValue: "-$4.2M", callValue: 0, putValue: -4_200_000, colorNorm: 0.7, tags: ["king"] }
  ],
  nodes: {
    king: { strike: 7175, value: -4_200_000 },
    positiveKing: { strike: 7200, value: 7_800_000 },
    negativeKing: { strike: 7175, value: -4_200_000 },
    aboveWall: { strike: 7200, value: 7_800_000 },
    belowWall: null
  }
};

describe("ExposureHeatmap", () => {
  it("renders latest ladder with metric controls and node badges", () => {
    render(<ExposureHeatmap initialPayload={payload} />);

    expect(screen.getByRole("heading", { name: "SPX 0DTE Exposure Heatmap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GEX" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "VEX" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Center spot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Center king" })).toBeInTheDocument();
    expect(screen.getByText("7175.00")).toBeInTheDocument();
    expect(screen.getByText("-$4.2M")).toBeInTheDocument();
    expect(screen.getByText("King")).toBeInTheDocument();
    expect(screen.getByText(/OI proxy/)).toBeInTheDocument();
  });

  it("renders provisional and persistence warnings", () => {
    render(<ExposureHeatmap initialPayload={{ ...payload, oiBaselineStatus: "provisional", persistenceStatus: "unavailable" }} />);

    expect(screen.getByText(/Baseline provisional/)).toBeInTheDocument();
    expect(screen.getByText(/Persistence unavailable/)).toBeInTheDocument();
  });
});
```

Create `apps/web/tests/HeatmapPage.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/clientHeatmapSource", () => ({
  loadClientHeatmap: async () => ({
    sessionId: "seed",
    symbol: "SPX",
    tradingClass: "SPXW",
    dte: 0,
    expirationDate: "2026-04-28",
    spot: 7173.91,
    metric: "gex",
    positionMode: "oi_proxy",
    oiBaselineStatus: "locked",
    oiBaselineCapturedAt: "2026-04-28T13:25:02Z",
    lastSyncedAt: "2026-04-28T14:00:44Z",
    isLive: true,
    isStale: false,
    persistenceStatus: "persisted",
    rows: [],
    nodes: { king: null, positiveKing: null, negativeKing: null, aboveWall: null, belowWall: null }
  })
}));

describe("Heatmap page", () => {
  it("renders the heatmap page shell", async () => {
    const Page = (await import("../app/heatmap/page")).default;

    render(await Page());

    expect(screen.getByRole("heading", { name: "SPX 0DTE Exposure Heatmap" })).toBeInTheDocument();
    expect(screen.getByText("SPXW")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- --run ExposureHeatmap HeatmapPage
```

Expected: fail because component and page files are missing.

- [ ] **Step 3: Implement toolbar component**

Create `apps/web/components/HeatmapToolbar.tsx`:

```tsx
"use client";

import type { HeatmapMetric } from "../lib/clientHeatmapSource";

const rangeOptions = ["+/-100", "+/-250", "+/-500", "all"];

export function HeatmapToolbar({
  metric,
  onMetricChange,
  onCenterSpot,
  onCenterKing
}: {
  metric: HeatmapMetric;
  onMetricChange: (metric: HeatmapMetric) => void;
  onCenterSpot: () => void;
  onCenterKing: () => void;
}) {
  return (
    <div className="heatmapToolbar" aria-label="Heatmap controls">
      <button type="button" aria-pressed={metric === "gex"} onClick={() => onMetricChange("gex")}>
        GEX
      </button>
      <button type="button" aria-pressed={metric === "vex"} onClick={() => onMetricChange("vex")}>
        VEX
      </button>
      <button type="button" onClick={onCenterSpot}>
        Center spot
      </button>
      <button type="button" onClick={onCenterKing}>
        Center king
      </button>
      <select aria-label="Strike range" defaultValue="+/-250">
        {rangeOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Implement node panel component**

Create `apps/web/components/HeatmapNodePanel.tsx`:

```tsx
import type { HeatmapNode, HeatmapPayload } from "../lib/clientHeatmapSource";

export function HeatmapNodePanel({ payload }: { payload: HeatmapPayload }) {
  return (
    <aside className="heatmapNodePanel" aria-label="Heatmap nodes">
      <div className="heatmapNodeHeader">
        <h2>Nodes</h2>
        <span>{payload.metric.toUpperCase()}</span>
      </div>
      <div className="heatmapNodeList">
        <NodeItem label="King node" node={payload.nodes.king} />
        <NodeItem label="Positive king" node={payload.nodes.positiveKing} />
        <NodeItem label="Negative king" node={payload.nodes.negativeKing} />
        <NodeItem label="Above spot wall" node={payload.nodes.aboveWall} />
        <NodeItem label="Below spot wall" node={payload.nodes.belowWall} />
      </div>
      <div className="heatmapDisclosure">
        <strong>{payload.oiBaselineStatus === "locked" ? "Baseline locked" : "Baseline provisional"}</strong>
        <span>OI proxy / estimated dealer exposure, baseline OI from 09:25 ET.</span>
        {payload.persistenceStatus === "unavailable" ? <span>Persistence unavailable</span> : null}
      </div>
    </aside>
  );
}

function NodeItem({ label, node }: { label: string; node: HeatmapNode | null }) {
  return (
    <div className="heatmapNodeItem">
      <span>{label}</span>
      <strong>{node ? `${node.strike.toFixed(2)} - ${formatNodeValue(node.value)}` : "Unavailable"}</strong>
    </div>
  );
}

function formatNodeValue(value: number): string {
  const prefix = value < 0 ? "-$" : "$";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${prefix}${(magnitude / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${prefix}${(magnitude / 1_000).toFixed(1)}K`;
  return `${prefix}${magnitude.toFixed(0)}`;
}
```

- [ ] **Step 5: Implement exposure heatmap component**

Create `apps/web/components/ExposureHeatmap.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import type { HeatmapMetric, HeatmapPayload } from "../lib/clientHeatmapSource";
import { exposureToneClass, formatHeatmapStatus, formatHeatmapTime } from "../lib/heatmapFormat";
import { HeatmapNodePanel } from "./HeatmapNodePanel";
import { HeatmapToolbar } from "./HeatmapToolbar";

export function ExposureHeatmap({ initialPayload }: { initialPayload: HeatmapPayload | null }) {
  const [payload, setPayload] = useState(initialPayload);
  const [metric, setMetric] = useState<HeatmapMetric>(initialPayload?.metric ?? "gex");
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const spotStrike = useMemo(() => nearestStrike(payload), [payload]);

  if (payload == null) {
    return (
      <main className="heatmapPage">
        <h1>SPX 0DTE Exposure Heatmap</h1>
        <p>No heatmap snapshot is available.</p>
      </main>
    );
  }

  const handleMetricChange = (nextMetric: HeatmapMetric) => {
    setMetric(nextMetric);
    setPayload({ ...payload, metric: nextMetric });
  };

  const centerStrike = (strike: number | null) => {
    if (strike == null) return;
    rowRefs.current.get(strike)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <main className="heatmapPage">
      <header className="heatmapHeader">
        <div>
          <h1>SPX 0DTE Exposure Heatmap</h1>
          <p>
            <strong>{payload.tradingClass}</strong> - Expiry {payload.expirationDate} - OI proxy / estimated dealer exposure
          </p>
        </div>
        <div className="heatmapStatusRail">
          <span>Spot {payload.spot.toFixed(2)}</span>
          <span className={`heatmapStatus heatmapStatus-${formatHeatmapStatus(payload).toLowerCase()}`}>
            {formatHeatmapStatus(payload)}
          </span>
          <span>Last synced {formatHeatmapTime(payload.lastSyncedAt)}</span>
        </div>
      </header>

      <HeatmapToolbar
        metric={metric}
        onMetricChange={handleMetricChange}
        onCenterSpot={() => centerStrike(spotStrike)}
        onCenterKing={() => centerStrike(payload.nodes.king?.strike ?? null)}
      />

      <section className="heatmapLayout">
        <div className="heatmapLadder" aria-label="Strike ladder">
          <div className="heatmapLadderHeader">
            <span>Strike</span>
            <span>{metric.toUpperCase()}</span>
          </div>
          <div className="heatmapRows">
            {payload.rows.map((row) => (
              <div
                key={row.strike}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.strike, element);
                }}
                className={`heatmapRow${row.strike === spotStrike ? " heatmapRow-spot" : ""}`}
              >
                <div className="heatmapStrike">{row.strike.toFixed(2)}</div>
                <div className={`heatmapCell ${exposureToneClass(row.value, row.colorNorm)}`}>
                  <div className="heatmapBadges">
                    {row.tags.includes("king") ? <span>King</span> : null}
                    {row.tags.includes("above_wall") ? <span>Above wall</span> : null}
                    {row.tags.includes("below_wall") ? <span>Below wall</span> : null}
                  </div>
                  <strong>{row.formattedValue}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
        <HeatmapNodePanel payload={payload} />
      </section>
    </main>
  );
}

function nearestStrike(payload: HeatmapPayload | null): number | null {
  if (payload == null || payload.rows.length === 0) return null;
  return payload.rows.reduce((nearest, row) =>
    Math.abs(row.strike - payload.spot) < Math.abs(nearest - payload.spot) ? row.strike : nearest,
  payload.rows[0]!.strike);
}
```

- [ ] **Step 6: Implement page**

Create `apps/web/app/heatmap/page.tsx`:

```tsx
import { ExposureHeatmap } from "../../components/ExposureHeatmap";
import { loadClientHeatmap } from "../../lib/clientHeatmapSource";

export default async function HeatmapPage() {
  const payload = await loadClientHeatmap("gex");
  return <ExposureHeatmap initialPayload={payload} />;
}
```

- [ ] **Step 7: Activate Heatmap nav link**

Modify the Heatmap tab in `apps/web/components/DashboardView.tsx` from a disabled `span` to:

```tsx
<a className="topNavTab" href="/heatmap">
  Heatmap
</a>
```

Do not alter realtime or replay dashboard behavior.

- [ ] **Step 8: Add styles**

Append focused styles to `apps/web/app/styles.css`:

```css
.heatmapPage {
  min-height: 100vh;
  padding: 24px;
  background: var(--page-bg, #0f172a);
  color: var(--text-primary, #f8fafc);
}

.heatmapHeader,
.heatmapToolbar,
.heatmapLayout,
.heatmapLadder,
.heatmapNodePanel {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.heatmapHeader {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.heatmapHeader h1 {
  margin: 0;
  font-size: 1.35rem;
}

.heatmapHeader p,
.heatmapStatusRail {
  color: var(--text-secondary, #94a3b8);
  font-size: 0.85rem;
}

.heatmapStatusRail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.heatmapStatus {
  border-radius: 999px;
  padding: 3px 8px;
  font-weight: 700;
}

.heatmapStatus-live {
  background: #dcfce7;
  color: #166534;
}

.heatmapStatus-stale {
  background: #fee2e2;
  color: #991b1b;
}

.heatmapStatus-delayed {
  background: #fef3c7;
  color: #92400e;
}

.heatmapToolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.heatmapToolbar button,
.heatmapToolbar select {
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.78);
  color: inherit;
  padding: 8px 10px;
  font-weight: 700;
}

.heatmapToolbar button[aria-pressed="true"] {
  background: #facc15;
  color: #111827;
}

.heatmapLayout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
}

.heatmapLadder,
.heatmapNodePanel {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  overflow: hidden;
}

.heatmapLadderHeader,
.heatmapRow {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
}

.heatmapLadderHeader {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  color: #cbd5e1;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.heatmapRows {
  max-height: 70vh;
  overflow: auto;
}

.heatmapRow {
  min-height: 28px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.82rem;
}

.heatmapStrike {
  border-right: 1px solid rgba(15, 23, 42, 0.3);
  padding: 6px 8px;
  font-weight: 800;
}

.heatmapRow-spot .heatmapStrike {
  background: #111827;
  color: white;
}

.heatmapCell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 9px;
}

.heatmapCell-neutral {
  background: rgba(100, 116, 139, 0.35);
}

.heatmapCell-positive.heatmapCell-intensity-1 { background: #256d85; }
.heatmapCell-positive.heatmapCell-intensity-2 { background: #238b83; }
.heatmapCell-positive.heatmapCell-intensity-3 { background: #55b45a; color: #06140d; }
.heatmapCell-positive.heatmapCell-intensity-4 { background: #facc15; color: #111827; }
.heatmapCell-negative.heatmapCell-intensity-1 { background: #315f82; }
.heatmapCell-negative.heatmapCell-intensity-2 { background: #43337e; }
.heatmapCell-negative.heatmapCell-intensity-3 { background: #34165d; }
.heatmapCell-negative.heatmapCell-intensity-4 { background: #22033d; }

.heatmapBadges {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.heatmapBadges span {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #111827;
  padding: 2px 6px;
  font-family: Inter, ui-sans-serif, system-ui;
  font-size: 0.68rem;
  font-weight: 800;
}

.heatmapNodeHeader,
.heatmapNodeItem,
.heatmapDisclosure {
  padding: 12px;
}

.heatmapNodeHeader {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}

.heatmapNodeHeader h2 {
  margin: 0;
  font-size: 0.9rem;
  text-transform: uppercase;
}

.heatmapNodeList {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.heatmapNodeItem {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.72);
}

.heatmapNodeItem span,
.heatmapDisclosure span {
  display: block;
  color: #94a3b8;
  font-size: 0.78rem;
}

.heatmapNodeItem strong {
  display: block;
  margin-top: 4px;
  font-family: "SFMono-Regular", Consolas, monospace;
}

.heatmapDisclosure {
  border-top: 1px solid rgba(148, 163, 184, 0.22);
}

@media (max-width: 860px) {
  .heatmapHeader,
  .heatmapLayout {
    grid-template-columns: 1fr;
  }

  .heatmapHeader {
    display: grid;
  }
}
```

- [ ] **Step 9: Run component/page tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- --run ExposureHeatmap HeatmapPage
```

Expected: component and page tests pass.

- [ ] **Step 10: Update nav tests**

Modify `apps/web/tests/LiveDashboard.test.tsx` and `apps/web/tests/ReplayDashboard.test.tsx` expectations that currently check Heatmap is disabled.

Replace disabled expectations with assertions that the markup contains a heatmap link:

```typescript
expect(markup).toContain('href="/heatmap"');
expect(markup).toContain("Heatmap");
```

- [ ] **Step 11: Run affected web tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run ExposureHeatmap HeatmapPage LiveDashboard ReplayDashboard
```

Expected: affected web tests pass.

- [ ] **Step 12: Commit Task 6**

Run:

```bash
git add apps/web/components/HeatmapToolbar.tsx apps/web/components/HeatmapNodePanel.tsx apps/web/components/ExposureHeatmap.tsx apps/web/app/heatmap/page.tsx apps/web/components/DashboardView.tsx apps/web/app/styles.css apps/web/tests/ExposureHeatmap.test.tsx apps/web/tests/HeatmapPage.test.tsx apps/web/tests/LiveDashboard.test.tsx apps/web/tests/ReplayDashboard.test.tsx
git commit -m "feat: add exposure heatmap page"
```

## Task 7: Final Integration Verification And Documentation

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Write failing README check**

Add a test to `tests/package-scripts.test.mjs` if it already contains README/script checks, or create `tests/heatmap-readme.test.mjs`:

```javascript
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("README documents the SPX heatmap API and page", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /SPX 0DTE Exposure Heatmap/);
  assert.match(readme, /\\/api\\/spx\\/0dte\\/heatmap\\/latest/);
  assert.match(readme, /09:25/);
});
```

- [ ] **Step 2: Run README test to verify RED**

Run:

```bash
node --test tests/heatmap-readme.test.mjs
```

Expected: fail because README does not document the heatmap yet.

- [ ] **Step 3: Update README**

Add a concise section after the Local Moomoo 0DTE Snapshot section:

```markdown
### SPX 0DTE Exposure Heatmap

The heatmap page is available at `http://localhost:3000/heatmap` when the web app is running.

The backend API is:

    GET /api/spx/0dte/heatmap/latest?metric=gex
    GET /api/spx/0dte/heatmap/latest?metric=vex

The first implementation uses signed OI proxy exposure: call open interest contributes positive exposure and put open interest contributes negative exposure. Moomoo open interest captured at or after 09:25 New York time is used as the daily baseline when available. Before that baseline is locked, heatmap payloads are marked provisional.

Heatmap snapshots are persisted to Postgres in full-resolution tables, with 5-minute bucket rows maintained for fast future history and replay work.
```

- [ ] **Step 4: Run README test to verify GREEN**

Run:

```bash
node --test tests/heatmap-readme.test.mjs
```

Expected: README test passes.

- [ ] **Step 5: Run backend heatmap verification**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_*.py -q
```

Expected: all backend heatmap tests pass.

- [ ] **Step 6: Run web heatmap verification**

Run:

```bash
pnpm --filter @gammascope/web test -- --run clientHeatmapSource heatmapFormat heatmapRoute ExposureHeatmap HeatmapPage LiveDashboard ReplayDashboard
```

Expected: affected web tests pass.

- [ ] **Step 7: Run web typecheck**

Run:

```bash
pnpm typecheck:web
```

Expected: typecheck exits with code 0.

- [ ] **Step 8: Run final focused package test**

Run:

```bash
node --test tests/heatmap-readme.test.mjs
```

Expected: README test exits with code 0.

- [ ] **Step 9: Commit Task 7**

Run:

```bash
git add README.md tests/heatmap-readme.test.mjs
git commit -m "docs: document exposure heatmap"
```

## Final Review And Verification

- [ ] **Step 1: Dispatch final code review subagent**

Use `superpowers:subagent-driven-development` final review step. The reviewer must check:

- Spec compliance against `docs/superpowers/specs/2026-04-28-spx-0dte-exposure-heatmap-design.md`.
- Backend heatmap API isolation.
- 09:25 New York OI baseline behavior.
- Full snapshot persistence plus 5-minute bucket persistence.
- Latest-only frontend ladder and no replay integration.
- Existing dashboard/replay/scenario behavior not intentionally changed.

- [ ] **Step 2: Run final verification before completion claim**

Use `superpowers:verification-before-completion`.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_*.py -q
pnpm --filter @gammascope/web test -- --run clientHeatmapSource heatmapFormat heatmapRoute ExposureHeatmap HeatmapPage LiveDashboard ReplayDashboard
pnpm typecheck:web
node --test tests/heatmap-readme.test.mjs
git status --short
```

Expected:

- Backend heatmap tests pass.
- Affected web tests pass.
- Web typecheck exits 0.
- README test passes.
- `git status --short` shows no uncommitted source changes unless intentionally left unstaged for the user.

- [ ] **Step 3: Finish branch**

Use `superpowers:finishing-a-development-branch` after final verification passes.
