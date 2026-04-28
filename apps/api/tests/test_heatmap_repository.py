from __future__ import annotations

from gammascope_api.heatmap.dependencies import (
    get_heatmap_repository,
    reset_heatmap_repository_override,
    set_heatmap_repository_override,
)
from gammascope_api.heatmap.repository import (
    HEATMAP_SCHEMA_SQL,
    HeatmapOiBaselineRecord,
    InMemoryHeatmapRepository,
)


def test_first_post_0925_baseline_locks_over_provisional_and_later_updates_do_not_override() -> None:
    repo = InMemoryHeatmapRepository()

    repo.upsert_oi_baseline(
        [
            _baseline("SPXW-2026-04-28-C-7200", 10, "2026-04-28T13:20:00Z"),
            _baseline("SPXW-2026-04-28-C-7200", 14, "2026-04-28T13:25:00Z"),
            _baseline("SPXW-2026-04-28-C-7200", 18, "2026-04-28T13:35:00Z"),
        ]
    )

    baselines = repo.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")

    assert len(baselines) == 1
    assert baselines[0].contract_id == "SPXW-2026-04-28-C-7200"
    assert baselines[0].open_interest == 14
    assert baselines[0].observed_at == "2026-04-28T13:25:00Z"
    assert baselines[0].locked is True


def test_oi_baseline_returns_multiple_contracts_for_expiration() -> None:
    repo = InMemoryHeatmapRepository()

    repo.upsert_oi_baseline(
        [
            _baseline("SPXW-2026-04-28-C-7200", 14, "2026-04-28T13:25:00Z"),
            _baseline("SPXW-2026-04-28-P-7200", 9, "2026-04-28T13:25:00Z"),
            _baseline("SPXW-2026-04-29-C-7200", 99, "2026-04-28T13:25:00Z", expiration_date="2026-04-29"),
        ]
    )

    baselines = repo.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")

    assert [record.contract_id for record in baselines] == [
        "SPXW-2026-04-28-C-7200",
        "SPXW-2026-04-28-P-7200",
    ]
    assert [record.open_interest for record in baselines] == [14, 9]


def test_snapshot_idempotent_upsert_and_latest_five_minute_bucket_payload() -> None:
    repo = InMemoryHeatmapRepository()
    payload = _snapshot_payload(rows=[{"strike": 7200, "gex": 100}, {"strike": 7210, "gex": -50}])

    first = repo.upsert_heatmap_snapshot(payload)
    second = repo.upsert_heatmap_snapshot(_snapshot_payload(rows=[{"strike": 7200, "gex": 120}]))
    bucket = repo.latest_bucket("session-1", "2026-04-28T14:05:00Z", "baseline")

    assert second["heatmap_snapshot_id"] == first["heatmap_snapshot_id"]
    assert second["row_count"] == 1
    assert bucket is not None
    assert bucket["heatmap_snapshot_id"] == first["heatmap_snapshot_id"]
    assert bucket["row_count"] == 1
    assert bucket["payload"]["rows"] == [{"strike": 7200, "gex": 120}]


def test_heatmap_schema_sql_contains_required_tables_and_unique_constraints() -> None:
    assert "CREATE TABLE IF NOT EXISTS heatmap_oi_baselines" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_snapshots" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_cells" in HEATMAP_SCHEMA_SQL
    assert "CREATE TABLE IF NOT EXISTS heatmap_bucket_5m" in HEATMAP_SCHEMA_SQL
    assert (
        "UNIQUE (market_date, symbol, trading_class, expiration_date, contract_id)"
        in HEATMAP_SCHEMA_SQL
    )
    assert "UNIQUE (session_id, source_snapshot_time, position_mode)" in HEATMAP_SCHEMA_SQL


def test_heatmap_repository_override_and_reset() -> None:
    override = InMemoryHeatmapRepository()

    set_heatmap_repository_override(override)
    try:
        assert get_heatmap_repository() is override
    finally:
        reset_heatmap_repository_override()

    assert get_heatmap_repository() is not override
    reset_heatmap_repository_override()


def _baseline(
    contract_id: str,
    open_interest: int,
    observed_at: str,
    *,
    expiration_date: str = "2026-04-28",
) -> HeatmapOiBaselineRecord:
    return HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date=expiration_date,
        contract_id=contract_id,
        open_interest=open_interest,
        observed_at=observed_at,
    )


def _snapshot_payload(*, rows: list[dict[str, object]]) -> dict[str, object]:
    return {
        "sessionId": "session-1",
        "lastSyncedAt": "2026-04-28T14:09:59Z",
        "positionMode": "baseline",
        "spot": 7000,
        "rows": rows,
    }
