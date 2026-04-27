# Parquet Import Review Public Replay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-only parquet import review flow, publish completed imports as public read-only replay sessions, and keep the April 22 parquet pair available only as an ignored local baseline.

**Architecture:** Port the validated parquet/archive/import ideas from `.worktrees/parquet-replay-import` into current `main`, but adapt them to the current Postgres replay and Next dashboard architecture. Backend import state, raw archive metadata, normalized source snapshots, and source quotes live in Postgres-backed import tables; public replay APIs assemble imported sessions into the existing `AnalyticsSnapshot` contract at runtime. Next.js owns the predefined website admin session and proxies import actions to FastAPI with the existing backend admin token.

**Tech Stack:** FastAPI, Python, PyArrow, psycopg/Postgres, Next.js App Router, React, TypeScript, Vitest, pytest, docker-compose Postgres.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-04-26-parquet-import-review-public-replay-design.md`
- Prior import branch material: `.worktrees/parquet-replay-import/apps/api/gammascope_api/replay/`
- Prior import tests: `.worktrees/parquet-replay-import/apps/api/tests/test_parquet_import.py`
- Current replay API: `apps/api/gammascope_api/routes/replay.py`
- Current replay persistence: `apps/api/gammascope_api/replay/repository.py`
- Current dashboard replay UI: `apps/web/components/ReplayPanel.tsx`, `apps/web/components/LiveDashboard.tsx`

## File Structure

Create backend import domain files:

- `apps/api/gammascope_api/replay/config.py`
  - Reads `GAMMASCOPE_REPLAY_ARCHIVE_DIR`, `GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES`, and local baseline paths.
- `apps/api/gammascope_api/replay/archive.py`
  - Computes SHA-256, archives uploaded files by import id, writes optional human-readable manifest.
- `apps/api/gammascope_api/replay/parquet_reader.py`
  - Reads parquet schemas with PyArrow, validates source facts, creates validation summaries, streams normalized quote records.
- `apps/api/gammascope_api/replay/import_repository.py`
  - Owns Postgres tables for imports, import snapshots, import quotes, timestamps, lifecycle transitions, import duplicate lookups, and the repository-to-builder data boundary for imported snapshots.
- `apps/api/gammascope_api/replay/importer.py`
  - Orchestrates upload validation, raw archive, lifecycle status, duplicate handling, confirm, cancel, and publish.
- `apps/api/gammascope_api/replay/imported_snapshot.py`
  - Assembles normalized imported snapshot rows and quote rows into the existing `AnalyticsSnapshot` JSON shape.
- `apps/api/gammascope_api/replay/baseline.py`
  - Optional local helper that imports `.gammascope/replay-baselines/2026-04-22/` when present.
- `apps/api/gammascope_api/routes/replay_imports.py`
  - FastAPI admin endpoints for upload, status, confirm, and cancel.

Modify backend files:

- `.gitignore`
  - Add `.gammascope/`.
- `apps/api/pyproject.toml`
  - Add `pyarrow` and `python-multipart`.
- `apps/api/gammascope_api/main.py`
  - Include `replay_imports.router`.
- `apps/api/gammascope_api/replay/dependencies.py`
  - Add import repository and importer dependency getters plus test overrides.
- `apps/api/gammascope_api/replay/repository.py`
  - Add `timestamp_source` to listed sessions, preserve estimated behavior for live-capture sessions, and exclude `source = "parquet_import"` from this JSONB replay repository so imported sessions do not appear twice.
- `apps/api/gammascope_api/routes/replay.py`
  - Merge completed imported sessions into public session lists, add exact timestamp route, and support `source_snapshot_id`.
- `apps/api/gammascope_api/routes/stream.py`
  - Pass `source_snapshot_id` into replay streaming and stream imported sessions in source order.

Create or modify backend tests:

- `apps/api/tests/replay_parquet_fixtures.py`
- `apps/api/tests/test_parquet_import_reader.py`
- `apps/api/tests/test_replay_import_repository.py`
- `apps/api/tests/test_replay_import_routes.py`
- `apps/api/tests/test_replay_import_snapshot.py`
- `apps/api/tests/test_replay_persistence.py`

Create website admin/import files:

- `apps/web/lib/adminSession.ts`
  - Signed cookie, credential check, CSRF token helpers.
- `apps/web/lib/replayImportSource.ts`
  - Client helpers and runtime validators for import status, upload, confirm, cancel, timestamps.
- `apps/web/app/api/admin/login/route.ts`
- `apps/web/app/api/admin/logout/route.ts`
- `apps/web/app/api/admin/session/route.ts`
- `apps/web/app/api/replay/imports/route.ts`
- `apps/web/app/api/replay/imports/[importId]/route.ts`
- `apps/web/app/api/replay/imports/[importId]/confirm/route.ts`
- `apps/web/app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route.ts`
- `apps/web/components/AdminLoginPanel.tsx`
- `apps/web/components/ReplayImportPanel.tsx`

Modify website files:

- `apps/web/lib/clientReplaySource.ts`
  - Add `timestamp_source`, exact timestamp entries, and `source_snapshot_id` support.
- `apps/web/lib/replayStream.ts`
  - Add `source_snapshot_id` to replay stream query params.
- `apps/web/app/api/spx/0dte/replay/snapshot/route.ts`
  - Forward `source_snapshot_id`.
- `apps/web/app/api/spx/0dte/replay/sessions/route.ts`
  - Validate `timestamp_source`.
- `apps/web/components/ReplayPanel.tsx`
  - Use exact timestamp entries where available.
- `apps/web/components/LiveDashboard.tsx`
  - Fetch admin session, import state, exact timestamps, and selected `source_snapshot_id`.
- `apps/web/app/styles.css`
  - Add compact admin/import/review styles consistent with the dashboard.

Create or modify website tests:

- `apps/web/tests/adminSession.test.ts`
- `apps/web/tests/replayImportRoute.test.ts`
- `apps/web/tests/replayImportSource.test.ts`
- `apps/web/tests/clientReplaySource.test.ts`
- `apps/web/tests/replayRoute.test.ts`
- `apps/web/tests/replayStream.test.ts`
- `apps/web/tests/ReplayImportPanel.test.tsx`
- `apps/web/tests/ReplayPanel.test.tsx`
- `apps/web/tests/LiveDashboard.test.tsx`

## Chunk 1: Dependency, Baseline, And Parquet Reader

### Task 1: Add ignored local baseline guardrails

**Files:**
- Modify: `.gitignore`
- Modify: `apps/api/pyproject.toml`
- Create: `apps/api/gammascope_api/replay/config.py`
- Test: `apps/api/tests/test_parquet_import_reader.py`

- [ ] **Step 1: Write failing dependency and config tests**

Add tests that prove:

```python
def test_pyarrow_and_multipart_dependencies_are_declared():
    pyproject = tomllib.loads(Path("apps/api/pyproject.toml").read_text())
    assert "pyarrow>=16" in pyproject["project"]["dependencies"]
    assert "python-multipart>=0.0.22" in pyproject["project"]["dependencies"]

def test_default_replay_archive_dir_is_ignored_local_path(monkeypatch):
    monkeypatch.delenv("GAMMASCOPE_REPLAY_ARCHIVE_DIR", raising=False)
    assert replay_archive_dir() == Path(".gammascope/replay-archive")

def test_default_import_max_bytes_is_100_mb(monkeypatch):
    monkeypatch.delenv("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES", raising=False)
    assert replay_import_max_bytes() == 100 * 1024 * 1024
```

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
```

Expected: FAIL because dependencies/config helpers do not exist.

- [ ] **Step 2: Implement config and gitignore**

Add `.gammascope/` to `.gitignore`.

In `apps/api/pyproject.toml`, add:

```toml
"pyarrow>=16",
"python-multipart>=0.0.22",
```

In `apps/api/gammascope_api/replay/config.py`, implement:

```python
from pathlib import Path
import os

DEFAULT_REPLAY_ARCHIVE_DIR = Path(".gammascope/replay-archive")
DEFAULT_BASELINE_DIR = Path(".gammascope/replay-baselines/2026-04-22")
DEFAULT_IMPORT_MAX_BYTES = 100 * 1024 * 1024

def replay_archive_dir() -> Path:
    return Path(os.environ.get("GAMMASCOPE_REPLAY_ARCHIVE_DIR", str(DEFAULT_REPLAY_ARCHIVE_DIR)))

def replay_import_max_bytes() -> int:
    value = os.environ.get("GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES")
    if value is None:
        return DEFAULT_IMPORT_MAX_BYTES
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_IMPORT_MAX_BYTES
    return max(1, parsed)

def replay_baseline_paths(base_dir: Path = DEFAULT_BASELINE_DIR) -> tuple[Path, Path]:
    return base_dir / "snapshots.parquet", base_dir / "quotes.parquet"
```

- [ ] **Step 3: Install updated backend dependencies**

Run:

```bash
.venv/bin/python -m pip install -e "apps/api[dev]"
```

Expected: `pyarrow` and `python-multipart` are importable from `.venv`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore apps/api/pyproject.toml apps/api/gammascope_api/replay/config.py apps/api/tests/test_parquet_import_reader.py
git commit -m "chore: add replay import dependency guardrails"
```

### Task 2: Port tiny parquet fixtures and reader validation

**Files:**
- Create: `apps/api/tests/replay_parquet_fixtures.py`
- Create: `apps/api/gammascope_api/replay/parquet_reader.py`
- Test: `apps/api/tests/test_parquet_import_reader.py`
- Reference: `.worktrees/parquet-replay-import/apps/api/gammascope_api/replay/parquet_reader.py`
- Reference: `.worktrees/parquet-replay-import/apps/api/tests/replay_parquet_fixtures.py`

- [ ] **Step 1: Write failing reader tests**

Port and adapt small fixture tests for:

- required snapshot and quote columns
- schema validation errors
- quote `iv` maps to `ibkr_iv`
- valid/invalid quote counts
- quote rows per snapshot
- duplicate `market_time` warning
- duplicate `snapshot_id` failure
- quote snapshot id with no matching snapshot failure
- expiry mismatch failure
- source `row_count` retained as diagnostics, not used as quote row count

Use tiny generated parquet files; do not use the real April 22 files in required tests.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
```

Expected: FAIL because `parquet_reader.py` does not exist.

- [ ] **Step 2: Implement the reader types**

In `apps/api/gammascope_api/replay/parquet_reader.py`, port the useful old-branch concepts but keep the API small:

```python
@dataclass(frozen=True)
class SnapshotRecord:
    session_id: str
    source_snapshot_id: str
    source_order: int
    snapshot_time: str
    expiry: str
    spot: float
    pricing_spot: float | None
    forward: float
    risk_free_rate: float
    t_minutes: float
    selected_strike_count: int
    valid_mid_contract_count: int
    stale_contract_count: int
    row_count: int

@dataclass(frozen=True)
class QuoteRecord:
    session_id: str
    source_snapshot_id: str
    source_order: int
    contract_id: str
    strike: float
    right: Literal["call", "put"]
    bid: float | None
    ask: float | None
    mid: float | None
    ibkr_iv: float | None
    open_interest: int | None
    quote_valid: bool
    ln_kf: float | None
    distance_from_atm: float | None

@dataclass(frozen=True)
class ReplayParquetReadResult:
    snapshots: list[SnapshotRecord]
    quotes: list[QuoteRecord]
    snapshot_id_map: dict[str, SnapshotRecord]
    summary: dict[str, Any]
    warnings: list[str]
    errors: list[str]
```

Reader behavior:

- Require the exact internal columns from the spec.
- Treat PyArrow partition-derived `trade_date` as optional and never required.
- Canonicalize expiry to `YYYY-MM-DD`.
- Prefer `pricing_spot` when finite and positive, otherwise `spot`.
- Convert option types to `call`/`put`.
- Derive `contract_id` as `SPXW-YYYY-MM-DD-C-STRIKE` or `SPXW-YYYY-MM-DD-P-STRIKE`.
- Preserve source order and duplicate timestamps.
- Build first/middle/last snapshot previews in `summary`.

- [ ] **Step 3: Stream quotes rather than loading full real files into memory**

Add:

```python
def iter_replay_quote_records(
    *,
    quotes_path: Path,
    snapshot_id_map: Mapping[str, SnapshotRecord],
    session_id: str,
    expiry: str,
) -> Iterator[QuoteRecord]:
    parquet_file = pq.ParquetFile(quotes_path)
    for batch in parquet_file.iter_batches(batch_size=50_000):
        yield from normalize_quote_batch(batch, snapshot_id_map=snapshot_id_map, session_id=session_id, expiry=expiry)
```

Use `pyarrow.parquet.ParquetFile.iter_batches()` so the 1.29M-row real quotes file can be handled in batches.

- [ ] **Step 4: Run focused tests**

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/gammascope_api/replay/parquet_reader.py apps/api/tests/replay_parquet_fixtures.py apps/api/tests/test_parquet_import_reader.py
git commit -m "feat: validate replay parquet files"
```

## Chunk 2: Archive, Import Repository, And Importer

### Task 3: Add raw archive helpers

**Files:**
- Create: `apps/api/gammascope_api/replay/archive.py`
- Test: `apps/api/tests/test_parquet_import_reader.py`
- Reference: `.worktrees/parquet-replay-import/apps/api/gammascope_api/replay/archive.py`

- [ ] **Step 1: Write failing archive tests**

Cover:

- `sha256_file(path)` returns stable hashes.
- `describe_source_file(path)` returns filename, size, and SHA-256.
- `archive_replay_files` copies to `<archive_dir>/<import_id>/snapshots.parquet` and `quotes.parquet`.
- archive manifest contains source filenames, sizes, checksums, and archive paths.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
```

Expected: FAIL because archive helpers do not exist.

- [ ] **Step 2: Implement archive helpers**

Keep the archive filesystem-only. Postgres remains the source of truth for import status.

Required dataclasses:

```python
@dataclass(frozen=True)
class SourceFileInfo:
    filename: str
    size: int
    sha256: str

@dataclass(frozen=True)
class ReplayArchive:
    import_id: str
    snapshots_path: Path
    quotes_path: Path
    snapshots_size: int
    quotes_size: int
    snapshots_sha256: str
    quotes_sha256: str
```

- [ ] **Step 3: Run focused tests and commit**

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py -q
git add apps/api/gammascope_api/replay/archive.py apps/api/tests/test_parquet_import_reader.py
git commit -m "feat: archive replay parquet uploads"
```

### Task 4: Add Postgres import repository

**Files:**
- Create: `apps/api/gammascope_api/replay/import_repository.py`
- Modify: `apps/api/gammascope_api/replay/dependencies.py`
- Test: `apps/api/tests/test_replay_import_repository.py`

- [ ] **Step 1: Write failing repository tests**

Use the same Postgres pattern as `apps/api/tests/test_replay_persistence.py`: skip if Postgres is unavailable, clean up created ids after each test.

Test:

- `ensure_schema()` creates import tables and adds `timestamp_source`, `quote_count`, `visibility`, and `import_id` columns to `replay_sessions` if missing.
- `create_import()` returns status `uploaded`.
- status transitions enforce `uploaded -> validating -> awaiting_confirmation -> publishing -> completed`.
- invalid confirm/cancel transitions return clear errors or `False`, not partial writes.
- `publish_import()` is transactional and creates:
  - one public `replay_sessions` row with `source = "parquet_import"` and `timestamp_source = "exact"`
  - normalized `replay_import_snapshots`
  - normalized `replay_import_quotes`
- `list_completed_sessions()` only returns completed public sessions.
- `timestamps(session_id)` returns `{ index, snapshot_time, source_snapshot_id }` in source order.
- duplicate checksum and duplicate identity queries work.

Run:

```bash
docker compose up -d postgres
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_repository.py -q
```

Expected: FAIL because repository does not exist.

- [ ] **Step 2: Implement tables and dataclasses**

Create these tables in `ensure_schema()`:

```sql
CREATE TABLE IF NOT EXISTS replay_imports (
    import_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    snapshots_filename TEXT NOT NULL,
    quotes_filename TEXT NOT NULL,
    snapshots_sha256 TEXT NOT NULL,
    quotes_sha256 TEXT NOT NULL,
    snapshots_size INTEGER NOT NULL,
    quotes_size INTEGER NOT NULL,
    snapshots_archive_path TEXT NOT NULL,
    quotes_archive_path TEXT NOT NULL,
    session_id TEXT,
    validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replay_import_snapshots (
    session_id TEXT NOT NULL,
    source_snapshot_id TEXT NOT NULL,
    source_order INTEGER NOT NULL,
    snapshot_time TIMESTAMPTZ NOT NULL,
    expiry TEXT NOT NULL,
    spot DOUBLE PRECISION NOT NULL,
    pricing_spot DOUBLE PRECISION,
    forward DOUBLE PRECISION NOT NULL,
    risk_free_rate DOUBLE PRECISION NOT NULL,
    t_minutes DOUBLE PRECISION NOT NULL,
    selected_strike_count INTEGER NOT NULL,
    valid_mid_contract_count INTEGER NOT NULL,
    stale_contract_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    PRIMARY KEY (session_id, source_snapshot_id)
);

CREATE TABLE IF NOT EXISTS replay_import_quotes (
    session_id TEXT NOT NULL,
    source_snapshot_id TEXT NOT NULL,
    source_order INTEGER NOT NULL,
    contract_id TEXT NOT NULL,
    strike DOUBLE PRECISION NOT NULL,
    right TEXT NOT NULL,
    bid DOUBLE PRECISION,
    ask DOUBLE PRECISION,
    mid DOUBLE PRECISION,
    ibkr_iv DOUBLE PRECISION,
    open_interest INTEGER,
    quote_valid BOOLEAN NOT NULL,
    ln_kf DOUBLE PRECISION,
    distance_from_atm DOUBLE PRECISION,
    PRIMARY KEY (session_id, source_snapshot_id, contract_id)
);
```

Use this shape:

- `replay_imports`
  - `import_id TEXT PRIMARY KEY`
  - `status TEXT NOT NULL`
  - source filenames, checksums, sizes, archive paths
  - `session_id TEXT`
  - `validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb`
  - `validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb`
  - `validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb`
  - created/updated timestamps
- `replay_import_snapshots`
  - `session_id`, `source_snapshot_id`, `source_order`, `snapshot_time`
  - expiry, spot, pricing spot, forward, risk-free rate, `t_minutes`
  - selected/valid/stale/source row count diagnostics
  - primary key `(session_id, source_snapshot_id)`
- `replay_import_quotes`
  - `session_id`, `source_snapshot_id`, `source_order`, `contract_id`
  - strike, right, bid, ask, mid, `ibkr_iv`, open interest, quote validity, diagnostics
  - primary key `(session_id, source_snapshot_id, contract_id)`

Extend `replay_sessions` with `ALTER TABLE replay_sessions ADD COLUMN IF NOT EXISTS` for:

```sql
quote_count INTEGER;
visibility TEXT NOT NULL DEFAULT 'public';
timestamp_source TEXT NOT NULL DEFAULT 'estimated';
import_id TEXT;
```

- [ ] **Step 3: Implement repository methods**

Define the repository-to-builder data boundary in `import_repository.py`:

```python
@dataclass(frozen=True)
class ImportedSnapshotHeader:
    session_id: str
    source_snapshot_id: str
    source_order: int
    snapshot_time: str
    expiry: str
    spot: float
    pricing_spot: float | None
    forward: float
    risk_free_rate: float
    t_minutes: float
    selected_strike_count: int
    valid_mid_contract_count: int
    stale_contract_count: int
    row_count: int

@dataclass(frozen=True)
class ImportedSnapshotData:
    header: ImportedSnapshotHeader
    quotes: list[QuoteRecord]
```

The repository returns stored source facts only. `imported_snapshot.py` computes derived analytics fields such as `discount_factor`, `dividend_yield`, row mids, custom IV, gamma, vanna, and coverage status.

Minimum repository methods:

```python
class ReplayImportRepository(Protocol):
    def ensure_schema(self) -> None: raise NotImplementedError
    def create_import(self, *, snapshots_filename: str, quotes_filename: str, snapshots_sha256: str, quotes_sha256: str, snapshots_size: int, quotes_size: int, snapshots_archive_path: str, quotes_archive_path: str) -> ImportRecord: raise NotImplementedError
    def get_import(self, import_id: str) -> ImportRecord: raise NotImplementedError
    def save_archive_metadata(self, import_id: str, *, snapshots_archive_path: str, quotes_archive_path: str, snapshots_sha256: str, quotes_sha256: str, snapshots_size: int, quotes_size: int) -> None: raise NotImplementedError
    def save_validation(self, import_id: str, *, summary: dict[str, Any], warnings: Sequence[str], errors: Sequence[str]) -> None: raise NotImplementedError
    def mark_validating(self, import_id: str) -> None: raise NotImplementedError
    def mark_awaiting_confirmation(self, import_id: str, *, session_id: str) -> None: raise NotImplementedError
    def mark_publishing(self, import_id: str) -> None: raise NotImplementedError
    def mark_completed(self, import_id: str, *, session_id: str) -> None: raise NotImplementedError
    def mark_failed(self, import_id: str, *, errors: Sequence[str]) -> None: raise NotImplementedError
    def mark_cancelled(self, import_id: str) -> None: raise NotImplementedError
    def publish_import(self, *, import_id: str, session_id: str, symbol: str, expiry: str, start_time: str, end_time: str, snapshots: Sequence[SnapshotRecord], quotes: Iterable[QuoteRecord]) -> None: raise NotImplementedError
    def list_completed_sessions(self) -> list[dict[str, Any]]: raise NotImplementedError
    def timestamps(self, session_id: str) -> list[dict[str, Any]]: raise NotImplementedError
    def snapshot_by_source_id(self, session_id: str, source_snapshot_id: str) -> ImportedSnapshotData | None: raise NotImplementedError
    def nearest_snapshot(self, session_id: str, at: str | None) -> ImportedSnapshotData | None: raise NotImplementedError
    def stream_snapshots(self, session_id: str, at: str | None, source_snapshot_id: str | None) -> list[ImportedSnapshotData]: raise NotImplementedError
```

- [ ] **Step 4: Wire dependency getters**

In `apps/api/gammascope_api/replay/dependencies.py`, add:

```python
_import_repository_override: ReplayImportRepository | None = None

def get_replay_import_repository() -> ReplayImportRepository:
    if _import_repository_override is not None:
        return _import_repository_override
    return _default_replay_import_repository(database_url())

def set_replay_import_repository_override(repository: ReplayImportRepository) -> None:
    global _import_repository_override
    _import_repository_override = repository

def reset_replay_import_repository_override() -> None:
    global _import_repository_override
    _import_repository_override = None
    _default_replay_import_repository.cache_clear()

@lru_cache(maxsize=1)
def _default_replay_import_repository(database_url: str) -> ReplayImportRepository:
    return PostgresReplayImportRepository(database_url)
```

- [ ] **Step 5: Run tests and commit**

```bash
docker compose up -d postgres
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_repository.py -q
git add apps/api/gammascope_api/replay/import_repository.py apps/api/gammascope_api/replay/dependencies.py apps/api/tests/test_replay_import_repository.py
git commit -m "feat: store replay import lifecycle in postgres"
```

### Task 5: Add importer orchestration

**Files:**
- Create: `apps/api/gammascope_api/replay/importer.py`
- Test: `apps/api/tests/test_replay_import_repository.py`
- Test: `apps/api/tests/test_parquet_import_reader.py`
- Reference: `.worktrees/parquet-replay-import/apps/api/gammascope_api/replay/importer.py`

- [ ] **Step 1: Write failing importer tests**

Test:

- valid tiny upload returns `awaiting_confirmation` with `import_id`, `summary`, warnings, empty errors, and `session_id`.
- corrupt parquet returns `failed` after import record is created.
- duplicate checksum against completed import returns the existing session on confirm.
- cancel works for unpublished imports and returns `409` semantics through service status.
- confirm writes normalized snapshots and quotes once.
- confirm completed import returns idempotent completed result.

Run:

```bash
docker compose up -d postgres
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py apps/api/tests/test_replay_import_repository.py -q
```

Expected: FAIL because importer does not exist.

- [ ] **Step 2: Implement result type and lifecycle orchestration**

Create:

```python
@dataclass(frozen=True)
class ImportResult:
    import_id: str
    status: str
    summary: dict[str, Any]
    warnings: list[str]
    errors: list[str]
    session_id: str | None = None
    replay_url: str | None = None
```

Implement:

- `create_import(snapshots_path, quotes_path)`
- `get_import(import_id)`
- `confirm_import(import_id)`
- `cancel_import(import_id)`

Rules:

- Create import record before schema validation when the upload contract has passed.
- Archive files before reading them.
- Generate stable session id from symbol, scope, trade date, expiry, start time, and checksum prefix.
- Save validation summary whether validation passes or fails.
- Only `awaiting_confirmation` can publish.
- `completed` confirm is idempotent `200` behavior at the route layer.
- Publishing must call one repository transaction.

- [ ] **Step 3: Add importer dependency getter**

In `apps/api/gammascope_api/replay/dependencies.py`, add:

```python
def get_replay_parquet_importer() -> ReplayParquetImporter:
    return ReplayParquetImporter(
        repository=get_replay_import_repository(),
        archive_dir=replay_archive_dir(),
    )
```

- [ ] **Step 4: Run focused tests and commit**

```bash
docker compose up -d postgres
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_parquet_import_reader.py apps/api/tests/test_replay_import_repository.py -q
git add apps/api/gammascope_api/replay/importer.py apps/api/gammascope_api/replay/dependencies.py apps/api/tests/test_parquet_import_reader.py apps/api/tests/test_replay_import_repository.py
git commit -m "feat: orchestrate replay parquet imports"
```

## Chunk 3: Imported Analytics Assembly And FastAPI Routes

### Task 6: Assemble imported snapshots into AnalyticsSnapshot

**Files:**
- Create: `apps/api/gammascope_api/replay/imported_snapshot.py`
- Test: `apps/api/tests/test_replay_import_snapshot.py`
- Modify: `apps/api/gammascope_api/replay/import_repository.py`

- [ ] **Step 1: Write failing assembly tests**

Use tiny normalized records and assert:

- output validates with `AnalyticsSnapshot.model_validate(payload)`
- `mode` is `replay`
- `source_status` is `connected`
- `coverage_status` is `partial` when some quotes are invalid, `full` when all are usable, `empty` when no rows
- `pricing_spot` is used for `spot` when available
- source `iv` appears as `ibkr_iv`
- `ibkr_gamma` and `ibkr_vanna` are `None`
- `custom_iv`, `custom_gamma`, and `custom_vanna` are recomputed by `calculate_row_analytics`
- invalid/missing quotes get visible `calc_status`

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_snapshot.py -q
```

Expected: FAIL because builder does not exist.

- [ ] **Step 2: Implement snapshot builder**

In `imported_snapshot.py`, implement:

```python
def build_imported_analytics_snapshot(snapshot: ImportedSnapshotData) -> dict[str, Any]:
    tau = time_to_expiry_years(snapshot.header.t_minutes)
    dividend_yield = infer_dividend_yield(
        spot=snapshot.header.pricing_spot or snapshot.header.spot,
        forward=snapshot.header.forward,
        rate=snapshot.header.risk_free_rate,
        tau=tau,
    )
    discount_factor = math.exp(-snapshot.header.risk_free_rate * tau)
    rows = [build_imported_analytics_row(snapshot.header, quote) for quote in snapshot.quotes]
    return {
        "schema_version": "1.0.0",
        "session_id": snapshot.header.session_id,
        "mode": "replay",
        "symbol": "SPX",
        "expiry": snapshot.header.expiry,
        "snapshot_time": snapshot.header.snapshot_time,
        "spot": snapshot.header.pricing_spot or snapshot.header.spot,
        "forward": snapshot.header.forward,
        "discount_factor": discount_factor,
        "risk_free_rate": snapshot.header.risk_free_rate,
        "dividend_yield": dividend_yield,
        "source_status": "connected",
        "freshness_ms": 0,
        "coverage_status": coverage_status(rows),
        "scenario_params": None,
        "rows": rows,
    }
```

Use existing helpers from `gammascope_api.analytics.black_scholes` and mirror the output shape in `apps/api/gammascope_api/ingestion/live_snapshot.py`.

Compute:

- `tau = max(t_minutes, 1 second) / (365 * 24 * 60)`
- `dividend_yield` inferred from spot, forward, rate, and tau when possible; otherwise `0.0`
- `discount_factor = exp(-risk_free_rate * tau)`
- `mid` from bid/ask for the contract payload

- [ ] **Step 3: Run focused tests and commit**

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_snapshot.py -q
git add apps/api/gammascope_api/replay/imported_snapshot.py apps/api/tests/test_replay_import_snapshot.py
git commit -m "feat: assemble imported replay snapshots"
```

### Task 7: Add FastAPI import endpoints

**Files:**
- Create: `apps/api/gammascope_api/routes/replay_imports.py`
- Modify: `apps/api/gammascope_api/main.py`
- Test: `apps/api/tests/test_replay_import_routes.py`

- [ ] **Step 1: Write failing route tests**

Use `TestClient(app)` and dependency overrides.

Test:

- missing `X-GammaScope-Admin-Token` returns `403`
- wrong token returns `403`
- upload requires exactly file fields `snapshots` and `quotes`
- wrong filenames return `400` before import record
- duplicate same-file checksums return `400` before import record
- oversize upload returns `413`
- successful upload returns `200` or `202` with `{ import_id, status, summary, warnings, errors, session_id, replay_url }`
- schema validation failure after import record returns `200` with `status: "failed"` and `import_id`
- `GET import` returns current result shape
- confirm awaiting import returns completed
- confirm completed import returns completed
- confirm invalid states returns `409`
- cancel unpublished returns cancelled
- cancel completed returns `409`

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_routes.py -q
```

Expected: FAIL because routes do not exist.

- [ ] **Step 2: Implement upload contract helpers**

In `routes/replay_imports.py`, implement:

```python
REQUIRED_FILENAMES = {"snapshots": "snapshots.parquet", "quotes": "quotes.parquet"}

async def _save_upload_to_temp(upload: UploadFile, *, max_bytes: int) -> tuple[Path, str, int]:
    path = temporary_upload_path(upload.filename)
    size = await copy_upload_with_limit(upload, path=path, max_bytes=max_bytes)
    return path, sha256_file(path), size
```

Important:

- FastAPI signature should name both required files:

```python
async def create_replay_import(
    snapshots: Annotated[UploadFile, File()],
    quotes: Annotated[UploadFile, File()],
    x_gammascope_admin_token: str | None = Header(default=None),
) -> dict[str, Any]:
```

- Validate filenames before importer call.
- Save to a temporary directory, enforcing `GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES` while reading chunks.
- Compute checksums of temp files before importer call to catch same-file duplicate upload.
- Return `400`/`413` before creating an import record for malformed upload contract failures.

- [ ] **Step 3: Implement route mapping**

Routes:

- `POST /api/replay/imports`
- `GET /api/replay/imports/{import_id}`
- `POST /api/replay/imports/{import_id}/confirm`
- `DELETE /api/replay/imports/{import_id}`

Map service state to HTTP:

- upload valid and synchronous: `200`
- upload accepted async if implementation later changes: `202`
- validation failed after import record: `200`
- missing import id: `404`
- invalid confirm/cancel state: `409`
- auth failure: `403`

- [ ] **Step 4: Register router and run tests**

In `main.py`:

```python
from gammascope_api.routes import replay_imports
app.include_router(replay_imports.router)
```

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_routes.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/gammascope_api/routes/replay_imports.py apps/api/gammascope_api/main.py apps/api/tests/test_replay_import_routes.py
git commit -m "feat: add replay import admin api"
```

### Task 8: Integrate imported sessions into public replay APIs

**Files:**
- Modify: `apps/api/gammascope_api/routes/replay.py`
- Modify: `apps/api/gammascope_api/routes/stream.py`
- Modify: `apps/api/gammascope_api/replay/repository.py`
- Test: `apps/api/tests/test_replay_persistence.py`
- Test: `apps/api/tests/test_replay_import_routes.py`

- [ ] **Step 1: Write failing replay integration tests**

Test:

- completed imported session appears in `/api/spx/0dte/replay/sessions` with `timestamp_source: "exact"`.
- completed imported session appears exactly once, even though imported metadata is stored in shared `replay_sessions`.
- seed and persisted live-capture sessions include `timestamp_source: "estimated"`.
- failed, cancelled, and awaiting imports do not appear in public session list.
- `GET /api/spx/0dte/replay/sessions/{session_id}/timestamps` returns exact source-order `{ index, snapshot_time, source_snapshot_id }`.
- estimated sessions return `timestamp_source: "estimated"` and empty timestamps.
- `GET /api/spx/0dte/replay/snapshot?session_id=&source_snapshot_id=` selects exact duplicate timestamp rows.
- `at` selection for imported sessions uses nearest timestamp and earlier source-order tie.
- unknown imported `source_snapshot_id` returns empty snapshot shape.
- replay WebSocket streams imported sessions in exact source order.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_persistence.py apps/api/tests/test_replay_import_routes.py -q
```

Expected: FAIL because public replay does not know imports yet.

- [ ] **Step 2: Extend replay session metadata**

In `apps/api/gammascope_api/replay/repository.py`, update `list_sessions()` to include:

```python
"timestamp_source": "estimated"
```

Also filter out rows where `source = 'parquet_import'`. Imported sessions are listed through `ReplayImportRepository.list_completed_sessions()` because they need exact timestamp metadata and normalized snapshot assembly. Do not require exact timestamp storage for existing `analytics_snapshots` replay capture.

- [ ] **Step 3: Merge imported sessions in replay routes**

In `routes/replay.py`:

- prepend completed imported sessions from `get_replay_import_repository().list_completed_sessions()`
- keep current persisted live sessions next
- keep seed session last
- include `timestamp_source` and `snapshot_count` on every session

Add route:

```python
@router.get("/api/spx/0dte/replay/sessions/{session_id}/timestamps")
def get_replay_session_timestamps(session_id: str) -> dict[str, Any]:
    entries = get_replay_import_repository().timestamps(session_id)
    return {"session_id": session_id, "timestamp_source": "exact" if entries else "estimated", "timestamps": entries}
```

- [ ] **Step 4: Add source snapshot selection**

Update `get_replay_snapshot` signature:

```python
def get_replay_snapshot(session_id: str, at: str | None = None, source_snapshot_id: str | None = None) -> dict:
```

Selection order:

1. completed imported session by `source_snapshot_id`
2. completed imported session by `at`
3. existing persisted JSONB replay by `at`
4. seed replay
5. empty replay shape

- [ ] **Step 5: Update replay stream**

In `routes/stream.py`, pass `source_snapshot_id` into a new `replay_stream_snapshots(session_id, at, source_snapshot_id)` path and stream imported snapshots from the repository in source order.

- [ ] **Step 6: Run focused tests and commit**

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_persistence.py apps/api/tests/test_replay_import_routes.py apps/api/tests/test_replay_import_snapshot.py -q
git add apps/api/gammascope_api/routes/replay.py apps/api/gammascope_api/routes/stream.py apps/api/gammascope_api/replay/repository.py apps/api/tests/test_replay_persistence.py apps/api/tests/test_replay_import_routes.py
git commit -m "feat: expose imported sessions through replay api"
```

### Task 9: Add local baseline import helper

**Files:**
- Create: `apps/api/gammascope_api/replay/baseline.py`
- Test: `apps/api/tests/test_replay_import_routes.py`
- Modify: `README.md`

- [ ] **Step 1: Write failing baseline tests**

Test:

- missing `.gammascope/replay-baselines/2026-04-22` returns skipped/no-op result.
- present baseline calls importer once and returns import result.
- running twice with the same checksums resolves idempotently to the existing completed session.

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_routes.py -q
```

Expected: FAIL because helper does not exist.

- [ ] **Step 2: Implement baseline helper**

Add:

```python
def import_local_baseline_if_present(importer: ReplayParquetImporter | None = None) -> ImportResult | None:
    snapshots_path, quotes_path = replay_baseline_paths()
    if not snapshots_path.exists() or not quotes_path.exists():
        return None
    created = importer.create_import(snapshots_path=snapshots_path, quotes_path=quotes_path)
    if created.status == "awaiting_confirmation":
        return importer.confirm_import(created.import_id)
    if created.status == "completed":
        return created
    return created
```

Add CLI entrypoint:

```python
if __name__ == "__main__":
    result = import_local_baseline_if_present()
    print("No local replay baseline found." if result is None else result)
```

- [ ] **Step 3: Document local copy command**

In `README.md`, add local-only instructions:

```bash
mkdir -p .gammascope/replay-baselines/2026-04-22
cp "/Users/sakura/Downloads/trade_date=2026-04-22 2/snapshots.parquet" .gammascope/replay-baselines/2026-04-22/snapshots.parquet
cp "/Users/sakura/Downloads/trade_date=2026-04-22 2/quotes.parquet" .gammascope/replay-baselines/2026-04-22/quotes.parquet
PYTHONPATH=apps/api .venv/bin/python -m gammascope_api.replay.baseline
```

State clearly that `.gammascope/` is ignored and must not be committed.

- [ ] **Step 4: Run tests and commit**

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_routes.py -q
git add apps/api/gammascope_api/replay/baseline.py apps/api/tests/test_replay_import_routes.py README.md
git commit -m "feat: add local replay baseline importer"
```

## Chunk 4: Website Admin Session And Import Proxy

### Task 10: Add website admin session helpers

**Files:**
- Create: `apps/web/lib/adminSession.ts`
- Create: `apps/web/app/api/admin/login/route.ts`
- Create: `apps/web/app/api/admin/logout/route.ts`
- Create: `apps/web/app/api/admin/session/route.ts`
- Test: `apps/web/tests/adminSession.test.ts`

- [ ] **Step 1: Write failing admin session tests**

Test:

- missing username/password/session secret makes admin unavailable.
- successful login with configured env returns `{ authenticated: true }` and sets `gammascope_admin`.
- failed login returns `401 { authenticated: false, error: "Invalid credentials" }`.
- session route returns `{ authenticated: true, csrf_token }` when cookie is valid.
- session route returns `{ authenticated: false, csrf_token: null }` when cookie is absent or invalid.
- login route `503` sets the dashboard admin-login availability state to false and keeps import controls hidden.
- logout clears cookie.
- unsafe helper rejects missing or mismatched `X-GammaScope-CSRF`.

Run:

```bash
pnpm --filter @gammascope/web test -- adminSession.test.ts
```

Expected: FAIL because helpers/routes do not exist.

- [ ] **Step 2: Implement signed cookie helpers**

In `adminSession.ts`, use Node `crypto` HMAC with `GAMMASCOPE_WEB_ADMIN_SESSION_SECRET`.

Export:

```ts
export const ADMIN_COOKIE_NAME = "gammascope_admin";
export function adminLoginAvailable(env?: NodeJS.ProcessEnv): boolean;
export function verifyAdminCredentials(username: string, password: string, env?: NodeJS.ProcessEnv): boolean;
export function createAdminSessionValue(now?: number): string;
export function parseAdminSessionValue(value: string | undefined, now?: number): AdminSession | null;
export function verifyCsrf(session: AdminSession | null, request: Request): boolean;
```

Cookie attributes:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- 8 hour lifetime
- `Secure` for HTTPS or production/hosted env

- [ ] **Step 3: Implement admin routes**

Route behavior:

- `POST /api/admin/login`
  - exempt from existing session and CSRF
  - returns `503` when env missing
  - returns generic `401` for invalid credentials
- `POST /api/admin/logout`
  - clears cookie, returns `{ authenticated: false }`
- `GET /api/admin/session`
  - returns current auth state and CSRF token

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @gammascope/web test -- adminSession.test.ts
git add apps/web/lib/adminSession.ts apps/web/app/api/admin apps/web/tests/adminSession.test.ts
git commit -m "feat: add website admin session"
```

### Task 11: Add Next import proxy routes

**Files:**
- Create: `apps/web/lib/replayImportSource.ts`
- Create: `apps/web/app/api/replay/imports/route.ts`
- Create: `apps/web/app/api/replay/imports/[importId]/route.ts`
- Create: `apps/web/app/api/replay/imports/[importId]/confirm/route.ts`
- Test: `apps/web/tests/replayImportRoute.test.ts`
- Test: `apps/web/tests/replayImportSource.test.ts`

- [ ] **Step 1: Write failing proxy tests**

Test:

- unauthenticated import proxy returns `403`.
- missing admin env returns `503`.
- missing CSRF on upload/confirm/cancel returns `403`.
- upload forwards multipart to FastAPI with `X-GammaScope-Admin-Token`.
- upload response preserves `{ import_id, status, summary, warnings, errors, session_id, replay_url }`.
- `GET import` requires admin session.
- confirm and cancel map upstream statuses through.
- invalid upstream response returns `502`.

Run:

```bash
pnpm --filter @gammascope/web test -- replayImportRoute.test.ts replayImportSource.test.ts
```

Expected: FAIL because proxy routes/helpers do not exist.

- [ ] **Step 2: Implement runtime validators and client helpers**

In `replayImportSource.ts`, define:

```ts
export interface ReplayImportResult {
  import_id: string;
  status: "uploaded" | "validating" | "awaiting_confirmation" | "publishing" | "completed" | "failed" | "cancelled";
  summary: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  session_id: string | null;
  replay_url: string | null;
}
```

Helpers:

- `isReplayImportResult(payload)`
- `uploadReplayImport(files, csrfToken)`
- `loadReplayImport(importId)`
- `confirmReplayImport(importId, csrfToken)`
- `cancelReplayImport(importId, csrfToken)`

- [ ] **Step 3: Implement proxy route guard**

Every unsafe admin proxy route should:

1. verify website admin session
2. verify `X-GammaScope-CSRF`
3. check `GAMMASCOPE_ADMIN_TOKEN`
4. forward to `GAMMASCOPE_API_BASE_URL ?? "http://127.0.0.1:8000"`

Use:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @gammascope/web test -- replayImportRoute.test.ts replayImportSource.test.ts
git add apps/web/lib/replayImportSource.ts apps/web/app/api/replay/imports apps/web/tests/replayImportRoute.test.ts apps/web/tests/replayImportSource.test.ts
git commit -m "feat: proxy replay imports through website admin"
```

## Chunk 5: Dashboard Import UI And Exact Replay Timestamps

### Task 12: Add import controls and review panel

**Files:**
- Create: `apps/web/components/AdminLoginPanel.tsx`
- Create: `apps/web/components/ReplayImportPanel.tsx`
- Modify: `apps/web/components/LiveDashboard.tsx`
- Modify: `apps/web/components/ReplayPanel.tsx`
- Modify: `apps/web/app/styles.css`
- Test: `apps/web/tests/ReplayImportPanel.test.tsx`
- Test: `apps/web/tests/LiveDashboard.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Test:

- public users do not see import controls.
- login form appears when admin session is absent and admin env is available.
- successful session shows import controls near replay controls.
- upload requires both files.
- review panel renders trade date, expiry, time range, counts, checksums, warnings, and first/middle/last previews.
- confirm refreshes replay sessions and selects the completed imported session.
- cancel clears unpublished import review.
- logout hides import controls.

Run:

```bash
pnpm --filter @gammascope/web test -- ReplayImportPanel.test.tsx LiveDashboard.test.tsx
```

Expected: FAIL because components are missing.

- [ ] **Step 2: Implement compact admin login panel**

Keep it operational and small. Do not make a landing page.

Props:

```ts
interface AdminLoginPanelProps {
  isAuthenticated: boolean;
  isAvailable: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onLogin(username: string, password: string): void;
  onLogout(): void;
}
```

`isAvailable` is dashboard state, not a required field on `GET /api/admin/session`. Initialize it to `true`; set it to `false` only when `POST /api/admin/login` returns `503 { authenticated: false, error: "Admin login unavailable" }`. Import controls must remain hidden whenever `isAuthenticated` is false.

- [ ] **Step 3: Implement import review panel**

Props:

```ts
interface ReplayImportPanelProps {
  isAdminAuthenticated: boolean;
  csrfToken: string | null;
  currentImport: ReplayImportResult | null;
  isUploading: boolean;
  isConfirming: boolean;
  errorMessage: string | null;
  onUpload(snapshots: File, quotes: File): void;
  onConfirm(importId: string): void;
  onCancel(importId: string): void;
}
```

Render:

- file inputs for `snapshots.parquet` and `quotes.parquet`
- upload button
- compact validation summary
- warning/error lists
- first/middle/last snapshot previews
- confirm/cancel buttons only for `awaiting_confirmation`

- [ ] **Step 4: Wire dashboard state**

In `LiveDashboard.tsx`:

- load `/api/admin/session` on mount
- keep `adminCsrfToken`
- call import proxy helpers
- refresh replay sessions after confirm
- select confirmed session id
- keep import UI hidden for public users

- [ ] **Step 5: Style and focused tests**

Add CSS under existing dashboard styles:

- `.adminPanel`
- `.replayImportPanel`
- `.importReviewGrid`
- `.importPreviewTable`
- `.importMessage`

Run:

```bash
pnpm --filter @gammascope/web test -- ReplayImportPanel.test.tsx LiveDashboard.test.tsx
pnpm typecheck:web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/AdminLoginPanel.tsx apps/web/components/ReplayImportPanel.tsx apps/web/components/LiveDashboard.tsx apps/web/components/ReplayPanel.tsx apps/web/app/styles.css apps/web/tests/ReplayImportPanel.test.tsx apps/web/tests/LiveDashboard.test.tsx
git commit -m "feat: add replay import review ui"
```

### Task 13: Add exact timestamp replay support in the website

**Files:**
- Modify: `apps/web/lib/clientReplaySource.ts`
- Modify: `apps/web/lib/replayStream.ts`
- Modify: `apps/web/app/api/spx/0dte/replay/snapshot/route.ts`
- Modify: `apps/web/app/api/spx/0dte/replay/sessions/route.ts`
- Create: `apps/web/app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route.ts`
- Modify: `apps/web/components/ReplayPanel.tsx`
- Modify: `apps/web/components/LiveDashboard.tsx`
- Test: `apps/web/tests/clientReplaySource.test.ts`
- Test: `apps/web/tests/replayRoute.test.ts`
- Test: `apps/web/tests/replayStream.test.ts`
- Test: `apps/web/tests/ReplayPanel.test.tsx`

- [ ] **Step 1: Write failing exact timestamp tests**

Test:

- `ReplaySession` accepts `timestamp_source: "exact" | "estimated"`.
- `loadClientReplayTimestamps(sessionId)` returns timestamp entries.
- exact timestamp options preserve duplicate timestamp rows by `source_snapshot_id`.
- `loadClientReplaySnapshot` forwards `source_snapshot_id`.
- replay snapshot Next route forwards `source_snapshot_id`.
- replay stream includes `source_snapshot_id`.
- estimated sessions keep current evenly spaced fallback behavior.

Run:

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts replayRoute.test.ts replayStream.test.ts ReplayPanel.test.tsx
```

Expected: FAIL because exact timestamp support is missing.

- [ ] **Step 2: Extend client replay types**

Add:

```ts
export interface ReplayTimestampEntry {
  index: number;
  snapshot_time: string;
  source_snapshot_id: string;
}

export interface ReplayTimestampResponse {
  session_id: string;
  timestamp_source: "exact" | "estimated";
  timestamps: ReplayTimestampEntry[];
}
```

Update `ReplaySnapshotRequest`:

```ts
export interface ReplaySnapshotRequest {
  session_id: string;
  at?: string;
  source_snapshot_id?: string;
}
```

- [ ] **Step 3: Update frontend routes and stream helper**

Forward `source_snapshot_id` through:

- `loadClientReplaySnapshot`
- `apps/web/app/api/spx/0dte/replay/snapshot/route.ts`
- `startReplayStream`

Create timestamp proxy route:

```text
GET /api/spx/0dte/replay/sessions/[sessionId]/timestamps
```

- [ ] **Step 4: Update replay panel selection model**

In `LiveDashboard.tsx`:

- when selected session changes and `timestamp_source === "exact"`, fetch timestamp entries
- use exact entries for the scrubber
- send both `at` and `source_snapshot_id` for exact imported sessions
- keep estimated fallback for seed/live-capture sessions

In `ReplayPanel.tsx`:

- display timestamp labels from exact entries
- keep stable scrubber dimensions
- keep duplicate timestamps selectable by index

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter @gammascope/web test -- clientReplaySource.test.ts replayRoute.test.ts replayStream.test.ts ReplayPanel.test.tsx LiveDashboard.test.tsx
pnpm typecheck:web
git add apps/web/lib/clientReplaySource.ts apps/web/lib/replayStream.ts apps/web/app/api/spx/0dte/replay apps/web/components/ReplayPanel.tsx apps/web/components/LiveDashboard.tsx apps/web/tests/clientReplaySource.test.ts apps/web/tests/replayRoute.test.ts apps/web/tests/replayStream.test.ts apps/web/tests/ReplayPanel.test.tsx apps/web/tests/LiveDashboard.test.tsx
git commit -m "feat: use exact imported replay timestamps"
```

## Chunk 6: Real-File Smoke, Browser QA, And Final Verification

### Task 14: Add optional real-file smoke coverage

**Files:**
- Create or modify: `apps/api/tests/test_replay_import_real_files.py`
- Modify: `README.md`

- [ ] **Step 1: Write optional smoke test**

The test must skip when local files are absent:

```python
def test_real_april_22_baseline_validates_when_present():
    snapshots, quotes = replay_baseline_paths()
    if not snapshots.exists() or not quotes.exists():
        pytest.skip("local replay baseline parquet files are absent")
    result = importer.create_import(snapshots_path=snapshots, quotes_path=quotes)
    assert result.status == "awaiting_confirmation"
    assert result.summary["snapshot_count"] == 15787
    assert result.summary["quote_count"] == 1294534
```

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_real_files.py -q
```

Expected: PASS if local files exist, SKIP otherwise.

- [ ] **Step 2: Verify no parquet files are tracked**

Run:

```bash
git status --short
git ls-files | rg '\\.parquet$' || true
```

Expected: no tracked parquet files.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/test_replay_import_real_files.py README.md
git commit -m "test: add optional replay import real-file smoke"
```

### Task 15: Full verification and browser smoke

**Files:**
- No new files unless fixing issues found during verification.

- [ ] **Step 1: Run backend focused suites**

```bash
docker compose up -d postgres
PYTHONPATH=apps/api .venv/bin/pytest \
  apps/api/tests/test_parquet_import_reader.py \
  apps/api/tests/test_replay_import_repository.py \
  apps/api/tests/test_replay_import_snapshot.py \
  apps/api/tests/test_replay_import_routes.py \
  apps/api/tests/test_replay_persistence.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused suites**

```bash
pnpm --filter @gammascope/web test -- \
  adminSession.test.ts \
  replayImportRoute.test.ts \
  replayImportSource.test.ts \
  clientReplaySource.test.ts \
  replayRoute.test.ts \
  replayStream.test.ts \
  ReplayImportPanel.test.tsx \
  ReplayPanel.test.tsx \
  LiveDashboard.test.tsx
pnpm typecheck:web
```

Expected: PASS.

- [ ] **Step 3: Run full repo verification**

```bash
pnpm test
pnpm test:collector
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests -q
.venv/bin/ruff check apps/api/gammascope_api apps/api/tests services/collector
pnpm --filter @gammascope/web build
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Run local app smoke**

Set local env:

```bash
export GAMMASCOPE_ADMIN_TOKEN="local-admin-token"
export GAMMASCOPE_WEB_ADMIN_USERNAME="admin"
export GAMMASCOPE_WEB_ADMIN_PASSWORD="admin-local-only"
export GAMMASCOPE_WEB_ADMIN_SESSION_SECRET="local-session-secret-with-enough-length"
export GAMMASCOPE_REPLAY_ARCHIVE_DIR=".gammascope/replay-archive"
```

Start services:

```bash
docker compose up -d postgres
pnpm dev:api
pnpm dev:web
```

Browser smoke:

- open the web app
- verify public user cannot see import controls
- log in with predefined admin credentials
- upload the local `snapshots.parquet` and `quotes.parquet`
- review counts and warnings
- confirm import
- verify replay sessions refresh and the imported session is selected
- move the scrubber across duplicate/exact timestamps
- load replay and play replay stream
- log out and confirm import controls disappear while public replay remains available

- [ ] **Step 5: Final safety checks**

```bash
git status --short
git ls-files | rg '\\.parquet$' || true
rg -n "admin-local-only|local-session-secret|/Users/sakura/Downloads|trade_date=2026-04-22 2" .
```

Expected:

- no tracked parquet files
- no committed real credentials
- no required absolute local file paths outside README local-copy instructions
- working tree only contains intentional code/doc changes

- [ ] **Step 6: Final commit if verification fixes were needed**

```bash
git add <changed-files>
git commit -m "fix: complete replay import verification"
```

## Execution Notes

- Work in a dedicated branch or worktree, for example `codex/parquet-import-review-replay`.
- Use TDD for each task: write the focused failing test, run it, implement the smallest passing change, rerun the focused test, then commit.
- Do not copy the real parquet files into tracked paths.
- Do not loosen public replay auth; only admin upload/review/confirm/cancel is private.
- Do not expose raw quote diagnostics in the public `AnalyticsSnapshot` contract.
- Prefer porting old branch code by behavior, not by blind merge.
- Keep completed imports playable from normalized Postgres rows even when the raw archive is unavailable.
