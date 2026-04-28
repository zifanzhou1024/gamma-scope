from __future__ import annotations

import pytest

from gammascope_api.heatmap.repository import HeatmapOiBaselineRecord, InMemoryHeatmapRepository
from gammascope_api.heatmap.service import build_heatmap_payload


def test_build_heatmap_payload_returns_gex_rows_nodes_and_persists() -> None:
    repository = InMemoryHeatmapRepository()

    payload = build_heatmap_payload(_snapshot("2026-04-28T13:25:00Z"), "gex", repository)

    assert payload["sessionId"] == "session-1"
    assert payload["symbol"] == "SPX"
    assert payload["tradingClass"] == "SPXW"
    assert payload["dte"] == 0
    assert payload["expirationDate"] == "2026-04-28"
    assert payload["spot"] == 7000
    assert payload["metric"] == "gex"
    assert payload["positionMode"] == "oi_proxy"
    assert payload["oiBaselineStatus"] == "locked"
    assert payload["oiBaselineCapturedAt"] == "2026-04-28T13:25:00Z"
    assert payload["lastSyncedAt"] == "2026-04-28T13:25:00Z"
    assert payload["isLive"] is True
    assert payload["isStale"] is False
    assert payload["persistenceStatus"] == "persisted"
    assert len(payload["rows"]) == 3

    row = _row(payload, 7010)
    assert row["value"] == pytest.approx(row["gex"])
    assert row["formattedValue"].startswith("$")
    assert row["callValue"] == pytest.approx(row["callGex"])
    assert row["putValue"] == pytest.approx(row["putGex"])
    assert row["colorNorm"] == row["colorNormGex"]
    assert isinstance(row["callVex"], float)
    assert set(row) >= {
        "strike",
        "value",
        "formattedValue",
        "callValue",
        "putValue",
        "colorNorm",
        "gex",
        "vex",
        "callGex",
        "putGex",
        "callVex",
        "putVex",
        "colorNormGex",
        "colorNormVex",
        "tags",
    }
    assert "king" in _row(payload, payload["nodes"]["king"]["strike"])["tags"]
    assert "above_wall" in _row(payload, payload["nodes"]["aboveWall"]["strike"])["tags"]
    assert "below_wall" in _row(payload, payload["nodes"]["belowWall"]["strike"])["tags"]

    bucket = repository.latest_bucket("session-1", "2026-04-28T13:25:00Z", "oi_proxy")
    assert bucket is not None
    assert bucket["payload"]["sessionId"] == "session-1"
    assert bucket["row_count"] == len(payload["rows"])


def test_build_heatmap_payload_uses_vex_active_value_color_and_components() -> None:
    payload = build_heatmap_payload(_snapshot("2026-04-28T13:25:00Z"), "vex", InMemoryHeatmapRepository())

    row = _row(payload, 6990)

    assert payload["metric"] == "vex"
    assert row["value"] == pytest.approx(row["vex"])
    assert row["callValue"] == pytest.approx(row["callVex"])
    assert row["putValue"] == pytest.approx(row["putVex"])
    assert row["colorNorm"] == row["colorNormVex"]
    assert payload["nodes"]["king"]["value"] == pytest.approx(_row(payload, payload["nodes"]["king"]["strike"])["vex"])


def test_build_heatmap_payload_marks_provisional_baseline_before_0925_new_york() -> None:
    payload = build_heatmap_payload(_snapshot("2026-04-28T13:24:59Z"), "gex", InMemoryHeatmapRepository())

    assert payload["oiBaselineStatus"] == "provisional"
    assert payload["oiBaselineCapturedAt"] is None
    assert payload["persistenceStatus"] == "persisted"


def test_build_heatmap_payload_returns_rows_when_persistence_fails() -> None:
    payload = build_heatmap_payload(_snapshot("2026-04-28T13:25:00Z"), "gex", _FailingRepository())

    assert payload["persistenceStatus"] == "unavailable"
    assert len(payload["rows"]) == 3
    assert payload["rows"][0]["value"] is not None


def test_build_heatmap_payload_reuses_existing_baseline_when_snapshot_oi_is_missing() -> None:
    repository = InMemoryHeatmapRepository()
    repository.upsert_oi_baseline(
        [
            _baseline(
                "SPXW-2026-04-28-C-7010",
                45,
                "2026-04-28T13:25:00Z",
                right="call",
                strike=7010,
            )
        ]
    )

    snapshot = _snapshot("2026-04-28T13:30:00Z")
    snapshot["rows"] = [_contract("SPXW-2026-04-28-C-7010", "call", 7010, None, 0.0020, 0.10)]

    payload = build_heatmap_payload(snapshot, "gex", repository)

    row = _row(payload, 7010)
    assert row["gex"] != 0
    assert "missing_oi_baseline" not in row["tags"]


def test_build_heatmap_payload_combines_existing_and_new_baseline_records() -> None:
    repository = InMemoryHeatmapRepository()
    repository.upsert_oi_baseline(
        [
            _baseline(
                "SPXW-2026-04-28-P-6990",
                80,
                "2026-04-28T13:24:00Z",
                right="put",
                strike=6990,
            )
        ]
    )
    snapshot = _snapshot("2026-04-28T13:25:00Z")
    snapshot["rows"] = [
        _contract("SPXW-2026-04-28-P-6990", "put", 6990, None, 0.0020, -0.20),
        _contract("SPXW-2026-04-28-C-7010", "call", 7010, 30, 0.0020, 0.10),
    ]

    payload = build_heatmap_payload(snapshot, "gex", repository)

    assert _row(payload, 6990)["gex"] != 0
    assert _row(payload, 7010)["gex"] != 0
    baselines = repository.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")
    assert {record.contract_id: record.open_interest for record in baselines} == {
        "SPXW-2026-04-28-P-6990": 80,
        "SPXW-2026-04-28-C-7010": 30,
    }


class _FailingRepository(InMemoryHeatmapRepository):
    def upsert_oi_baseline(self, records):  # type: ignore[no-untyped-def]
        raise RuntimeError("database unavailable")

    def upsert_heatmap_snapshot(self, payload):  # type: ignore[no-untyped-def]
        raise RuntimeError("database unavailable")


def _snapshot(snapshot_time: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "session_id": "session-1",
        "mode": "live",
        "symbol": "SPX",
        "expiry": "2026-04-28",
        "snapshot_time": snapshot_time,
        "spot": 7000,
        "freshness_ms": 500,
        "rows": [
            _contract("SPXW-2026-04-28-P-6990", "put", 6990, 80, 0.0020, -0.20),
            _contract("SPXW-2026-04-28-C-7010", "call", 7010, 30, 0.0020, 0.10),
            _contract("SPXW-2026-04-28-C-7020", "call", 7020, 80, 0.0020, -0.05),
        ],
    }


def _contract(
    contract_id: str,
    right: str,
    strike: float,
    open_interest: int | None,
    gamma: float,
    vanna: float,
) -> dict:
    return {
        "contract_id": contract_id,
        "right": right,
        "strike": strike,
        "open_interest": open_interest,
        "custom_gamma": gamma,
        "custom_vanna": vanna,
    }


def _row(payload: dict, strike: float) -> dict:
    return next(row for row in payload["rows"] if row["strike"] == strike)


def _baseline(
    contract_id: str,
    open_interest: int,
    observed_at: str,
    *,
    right: str,
    strike: float,
) -> HeatmapOiBaselineRecord:
    return HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date="2026-04-28",
        contract_id=contract_id,
        right=right,
        strike=strike,
        open_interest=open_interest,
        observed_at=observed_at,
        captured_at=observed_at,
        source_snapshot_time=observed_at,
    )
