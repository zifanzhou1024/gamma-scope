from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from gammascope_api.heatmap.dependencies import (
    get_heatmap_repository,
    reset_heatmap_repository_override,
    set_heatmap_repository_override,
)
from gammascope_api.heatmap.repository import (
    HEATMAP_SCHEMA_SQL,
    HeatmapOiBaselineRecord,
    InMemoryHeatmapRepository,
    PostgresHeatmapRepository,
)
from gammascope_api.heatmap import repository as repository_module


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
    assert baselines[0].captured_at == "2026-04-28T13:25:00Z"
    assert baselines[0].source_snapshot_time == "2026-04-28T13:25:00Z"
    assert baselines[0].locked is True


def test_oi_baseline_round_trips_contract_metadata() -> None:
    repo = InMemoryHeatmapRepository()

    repo.upsert_oi_baseline(
        [
            _baseline(
                "SPXW-2026-04-28-P-7200",
                14,
                "2026-04-28T13:20:00Z",
                right="put",
                strike=7200,
                captured_at="2026-04-28T13:25:02Z",
                source_snapshot_time="2026-04-28T13:25:00Z",
            )
        ]
    )

    baselines = repo.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")

    assert len(baselines) == 1
    assert baselines[0].right == "put"
    assert baselines[0].strike == 7200
    assert baselines[0].captured_at == "2026-04-28T13:25:02Z"
    assert baselines[0].source_snapshot_time == "2026-04-28T13:25:00Z"
    assert baselines[0].observed_at == "2026-04-28T13:20:00Z"


def test_source_snapshot_time_locks_baseline_even_when_observed_at_is_before_lock_time() -> None:
    repo = InMemoryHeatmapRepository()

    repo.upsert_oi_baseline(
        [
            _baseline(
                "SPXW-2026-04-28-C-7200",
                14,
                "2026-04-28T13:20:00Z",
                captured_at="2026-04-28T13:25:02Z",
                source_snapshot_time="2026-04-28T13:25:00Z",
            ),
            _baseline(
                "SPXW-2026-04-28-C-7200",
                18,
                "2026-04-28T13:35:00Z",
                captured_at="2026-04-28T13:35:02Z",
                source_snapshot_time="2026-04-28T13:35:00Z",
            ),
        ]
    )

    baselines = repo.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")

    assert len(baselines) == 1
    assert baselines[0].open_interest == 14
    assert baselines[0].observed_at == "2026-04-28T13:20:00Z"
    assert baselines[0].source_snapshot_time == "2026-04-28T13:25:00Z"
    assert baselines[0].locked is True


def test_provisional_baseline_ignores_older_source_snapshot_time_update() -> None:
    repo = InMemoryHeatmapRepository()

    repo.upsert_oi_baseline(
        [
            _baseline("SPXW-2026-04-28-C-7200", 14, "2026-04-28T13:20:00Z"),
            _baseline(
                "SPXW-2026-04-28-C-7200",
                9,
                "2026-04-28T13:21:00Z",
                source_snapshot_time="2026-04-28T13:19:00Z",
            ),
        ]
    )

    baselines = repo.oi_baseline("2026-04-28", "SPX", "SPXW", "2026-04-28")

    assert len(baselines) == 1
    assert baselines[0].open_interest == 14
    assert baselines[0].source_snapshot_time == "2026-04-28T13:20:00Z"
    assert baselines[0].locked is False


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


def test_heatmap_schema_sql_structures_baseline_metadata() -> None:
    baseline_sql = _table_sql("heatmap_oi_baselines")
    for column in [
        '"right" TEXT NOT NULL',
        "strike DOUBLE PRECISION NOT NULL",
        "captured_at TIMESTAMPTZ NOT NULL",
        "source_snapshot_time TIMESTAMPTZ NOT NULL",
    ]:
        assert column in baseline_sql


def test_heatmap_schema_sql_structures_snapshot_metadata() -> None:
    snapshot_sql = _table_sql("heatmap_snapshots")
    for column in [
        "symbol TEXT NOT NULL",
        "trading_class TEXT NOT NULL",
        "expiration_date DATE NOT NULL",
        "spot DOUBLE PRECISION NOT NULL",
        "oi_baseline_status TEXT",
        "oi_baseline_captured_at TIMESTAMPTZ",
    ]:
        assert column in snapshot_sql


def test_heatmap_schema_sql_structures_cell_metrics() -> None:
    cell_sql = _table_sql("heatmap_cells")
    for column in [
        "gex DOUBLE PRECISION",
        "vex DOUBLE PRECISION",
        "call_gex DOUBLE PRECISION",
        "put_gex DOUBLE PRECISION",
        "call_vex DOUBLE PRECISION",
        "put_vex DOUBLE PRECISION",
        "color_norm_gex DOUBLE PRECISION",
        "color_norm_vex DOUBLE PRECISION",
        "tags JSONB NOT NULL DEFAULT '[]'::JSONB",
    ]:
        assert column in cell_sql


def test_heatmap_cell_record_extracts_camel_case_payload_metrics() -> None:
    row = {
        "strike": 7200,
        "gex": 10.5,
        "vex": -2.25,
        "callGex": 6.0,
        "putGex": 4.5,
        "callVex": -1.0,
        "putVex": -1.25,
        "colorNormGex": 0.5,
        "colorNormVex": -0.25,
        "tags": ["missing_oi_baseline"],
    }

    record = repository_module._heatmap_cell_record(row)

    assert record == {
        "strike": 7200.0,
        "gex": 10.5,
        "vex": -2.25,
        "call_gex": 6.0,
        "put_gex": 4.5,
        "call_vex": -1.0,
        "put_vex": -1.25,
        "color_norm_gex": 0.5,
        "color_norm_vex": -0.25,
        "tags": ["missing_oi_baseline"],
    }


def test_heatmap_cell_record_extracts_snake_case_payload_metrics() -> None:
    row = {
        "strike": "7200",
        "gex": "10.5",
        "vex": "-2.25",
        "call_gex": "6.0",
        "put_gex": "4.5",
        "call_vex": "-1.0",
        "put_vex": "-1.25",
        "color_norm_gex": "0.5",
        "color_norm_vex": "-0.25",
        "tags": ("zero_gamma",),
    }

    record = repository_module._heatmap_cell_record(row)

    assert record == {
        "strike": 7200.0,
        "gex": 10.5,
        "vex": -2.25,
        "call_gex": 6.0,
        "put_gex": 4.5,
        "call_vex": -1.0,
        "put_vex": -1.25,
        "color_norm_gex": 0.5,
        "color_norm_vex": -0.25,
        "tags": ["zero_gamma"],
    }


def test_postgres_oi_baseline_insert_placeholders_match_parameters() -> None:
    repo = _RecordingPostgresHeatmapRepository()

    repo.upsert_oi_baseline([_baseline("SPXW-2026-04-28-C-7200", 14, "2026-04-28T13:25:00Z")])

    insert_sql, insert_params = repo.executions[1]

    assert "INSERT INTO heatmap_oi_baselines" in insert_sql
    assert _values_placeholder_count(insert_sql) == len(insert_params)


def test_postgres_oi_baseline_conflict_predicate_matches_provisional_replacement_semantics() -> None:
    repo = _RecordingPostgresHeatmapRepository()

    repo.upsert_oi_baseline([_baseline("SPXW-2026-04-28-C-7200", 14, "2026-04-28T13:25:00Z")])

    insert_sql, _insert_params = repo.executions[1]

    assert "WHERE heatmap_oi_baselines.locked = FALSE" in insert_sql
    assert "EXCLUDED.locked = TRUE" in insert_sql
    assert "EXCLUDED.source_snapshot_time >= heatmap_oi_baselines.source_snapshot_time" in insert_sql


def test_postgres_snapshot_allows_missing_optional_baseline_metadata() -> None:
    repo = _RecordingPostgresHeatmapRepository()
    payload = _snapshot_payload(rows=[])
    payload.pop("oiBaselineStatus")
    payload.pop("oiBaselineCapturedAt")

    repo.upsert_heatmap_snapshot(payload)

    snapshot_sql, snapshot_params = repo.executions[1]

    assert "INSERT INTO heatmap_snapshots" in snapshot_sql
    assert snapshot_params[7] is None
    assert snapshot_params[8] is None


def test_json_safe_payload_normalizes_dataclass_rows() -> None:
    row = _SnapshotRow(strike=7200, gex=10.5, callGex=6.0, tags=["zero_gamma"])
    payload = _snapshot_payload(rows=[row])

    safe_payload = repository_module._json_safe_payload(payload)

    assert safe_payload["rows"] == [
        {
            "strike": 7200,
            "gex": 10.5,
            "callGex": 6.0,
            "tags": ["zero_gamma"],
        }
    ]


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
    right: str = "call",
    strike: float = 7200,
    captured_at: str | None = None,
    source_snapshot_time: str | None = None,
) -> HeatmapOiBaselineRecord:
    return HeatmapOiBaselineRecord(
        market_date="2026-04-28",
        symbol="SPX",
        trading_class="SPXW",
        expiration_date=expiration_date,
        contract_id=contract_id,
        right=right,
        strike=strike,
        open_interest=open_interest,
        observed_at=observed_at,
        captured_at=captured_at or observed_at,
        source_snapshot_time=source_snapshot_time or observed_at,
    )


def _snapshot_payload(*, rows: list[object]) -> dict[str, object]:
    return {
        "sessionId": "session-1",
        "lastSyncedAt": "2026-04-28T14:09:59Z",
        "positionMode": "baseline",
        "symbol": "SPX",
        "tradingClass": "SPXW",
        "expirationDate": "2026-04-28",
        "spot": 7000,
        "oiBaselineStatus": "available",
        "oiBaselineCapturedAt": "2026-04-28T13:25:00Z",
        "rows": rows,
    }


def _table_sql(table_name: str) -> str:
    start_marker = f"CREATE TABLE IF NOT EXISTS {table_name}"
    start = HEATMAP_SCHEMA_SQL.index(start_marker)
    end = HEATMAP_SCHEMA_SQL.index(");", start)
    return HEATMAP_SCHEMA_SQL[start:end]


@dataclass(frozen=True)
class _SnapshotRow:
    strike: float
    gex: float
    callGex: float
    tags: list[str]


def _values_placeholder_count(sql: str) -> int:
    values_start = sql.index("VALUES (") + len("VALUES (")
    values_end = sql.index(")", values_start)
    return sql[values_start:values_end].count("%s")


class _RecordingPostgresHeatmapRepository(PostgresHeatmapRepository):
    def __init__(self) -> None:
        super().__init__("postgresql://unused")
        self.executions: list[tuple[str, tuple[object, ...]]] = []

    def _connect(self) -> "_RecordingConnection":
        return _RecordingConnection(self)


class _RecordingConnection:
    def __init__(self, repository: _RecordingPostgresHeatmapRepository) -> None:
        self.repository = repository

    def __enter__(self) -> "_RecordingConnection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> "_RecordingCursor":
        return _RecordingCursor(self.repository)


class _RecordingCursor:
    def __init__(self, repository: _RecordingPostgresHeatmapRepository) -> None:
        self.repository = repository

    def __enter__(self) -> "_RecordingCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None:
        self.repository.executions.append((sql, params))

    def fetchone(self) -> tuple[object, ...]:
        last_sql = self.repository.executions[-1][0]
        if "INSERT INTO heatmap_snapshots" in last_sql:
            return (
                1,
                "session-1",
                datetime(2026, 4, 28, 14, 9, 59, tzinfo=UTC),
                "baseline",
                0,
            )
        return (
            "2026-04-28",
            "SPX",
            "SPXW",
            "2026-04-28",
            "SPXW-2026-04-28-C-7200",
            "call",
            7200.0,
            14,
            datetime(2026, 4, 28, 13, 25, tzinfo=UTC),
            datetime(2026, 4, 28, 13, 25, tzinfo=UTC),
            datetime(2026, 4, 28, 13, 25, tzinfo=UTC),
            True,
        )
