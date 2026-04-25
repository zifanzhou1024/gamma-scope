# Parquet Replay Import Design

Date: 2026-04-24
Status: Approved for implementation planning
Repository: gamma-scope

## Summary

GammaScope should import a friend's SPX 0DTE replay dataset from two Parquet files, persist the imported session, and replay it through the existing website and API contracts. The import flow is admin-only. Public users can replay completed sessions but cannot upload files.

The selected architecture is a normalized import layer plus a raw-file archive. Uploaded Parquet files are archived for audit and reimport safety, then converted into GammaScope-owned replay storage. Runtime replay reads the normalized storage, not the raw Parquet files.

The friend's `iv` field is IBKR implied volatility. GammaScope must store it as `ibkr_iv` and compute its own `custom_iv`, `custom_gamma`, and `custom_vanna` from bid/ask/spot/time using the existing analytics engine.

## Goals

- Add an admin-only website button for importing replay data.
- Accept exactly the two source files for a session: `snapshots.parquet` and `quotes.parquet`.
- Persist imported replay sessions after refresh and server restart.
- Preserve every source snapshot timestamp without downsampling.
- Archive the original files with metadata and checksums.
- Normalize source rows into GammaScope replay storage.
- Expose imported sessions through existing public replay APIs.
- Keep the frontend-facing response shape as `AnalyticsSnapshot`.
- Treat friend-file `iv` as IBKR comparison IV, not custom IV.
- Recompute GammaScope custom analytics from source quote facts.

## Non-Goals

- Do not let public users upload replay files.
- Do not use the raw Parquet files as the live runtime query source after import.
- Do not downsample snapshots in the first version.
- Do not add multi-symbol support beyond the current SPX 0DTE scope.
- Do not replace the broader future Postgres/Redis architecture; this import layer should fit it.
- Do not persist scenario results as market data.

## Source Data Observed

The provided dataset contains:

- `snapshots.parquet`: 15,787 rows, one row per replay timestamp.
- `quotes.parquet`: 1,294,534 rows, exactly 82 quote rows per snapshot.
- Time range: `2026-04-22T13:30:02Z` through `2026-04-22T19:59:58Z`.
- Join key: `snapshot_id`.
- Expiry value: `20260422`.
- Snapshot cadence: mostly one to two seconds, with a maximum observed gap of seven seconds.
- Quote rows include calls and puts, bid/ask/mid, IBKR IV, open interest, quote validity, and strike distance from ATM.

Observed `snapshots.parquet` columns:

- `snapshot_id`
- `archived_at`
- `updated_at`
- `market_time`
- `market_open`
- `expiry`
- `spot`
- `pricing_spot`
- `atm_strike`
- `atm_iv`
- `min_iv_strike`
- `forward_price`
- `k0_strike`
- `t_minutes`
- `risk_free_rate`
- `selected_strike_count`
- `valid_mid_contract_count`
- `stale_contract_count`
- `row_count`

Observed `quotes.parquet` columns:

- `snapshot_id`
- `market_time`
- `expiry`
- `strike`
- `option_type`
- `bid`
- `ask`
- `mid`
- `iv`
- `oi`
- `ln_kf`
- `quote_valid`
- `distance_from_atm`

## Selected Architecture

Use two storage layers.

### Raw Archive Layer

The raw archive stores the original `snapshots.parquet` and `quotes.parquet` files after upload. It also stores import metadata:

- import id
- session id
- original filenames
- file sizes
- file checksums
- detected trade date
- detected expiry
- detected time range
- row counts
- import status
- validation warnings and errors
- created time

The archive exists for traceability, debugging, and future reimport. It is not the primary runtime replay source.

### Normalized Replay Layer

The normalized replay layer stores GammaScope-owned replay facts:

- replay session metadata
- one stored snapshot record per source `snapshot_id`
- one stored quote record per source quote row

The replay API assembles `AnalyticsSnapshot` responses from this normalized layer. This keeps the friend schema isolated at the import boundary and lets GammaScope change analytics formulas later without asking the user to upload the files again.

## Data Mapping

### Session Mapping

An imported session should derive:

- `session_id`: stable GammaScope id, for example `import-spx-2026-04-22-<short-hash>`.
- `symbol`: `SPX`.
- `expiry`: source `expiry` converted from `YYYYMMDD` to `YYYY-MM-DD`.
- `start_time`: minimum snapshot `market_time`.
- `end_time`: maximum snapshot `market_time`.
- `snapshot_count`: number of source snapshot rows.
- `quote_count`: number of source quote rows.
- `source`: an import/archive source marker.
- `visibility`: public replay once import completes.

### Snapshot Mapping

For each `snapshots.parquet` row:

- `snapshot_id` stays as the source join key and is stored for traceability.
- `market_time` maps to `snapshot_time`.
- `expiry` maps to canonical `YYYY-MM-DD`.
- `spot` or `pricing_spot` maps to GammaScope `spot`; prefer `pricing_spot` when present and valid.
- `forward_price` maps to `forward`.
- `risk_free_rate` maps to `risk_free_rate`.
- `t_minutes` is retained for audit and can be used to derive time-to-expiry when assembling analytics.
- `selected_strike_count`, `valid_mid_contract_count`, `stale_contract_count`, and `row_count` feed coverage and validation reporting.

`discount_factor` can be computed from `risk_free_rate` and time-to-expiry. If the source includes `forward_price`, GammaScope should preserve that forward instead of deriving it from dividend yield.

### Quote Mapping

For each `quotes.parquet` row:

- `snapshot_id` joins to the normalized snapshot record.
- `strike` maps to row `strike`.
- `option_type` maps `C` to `call` and `P` to `put`.
- `bid`, `ask`, and `mid` map to quote values.
- `iv` maps to `ibkr_iv`.
- `oi` maps to open interest in normalized storage, even though it is not currently part of `AnalyticsSnapshot`.
- `quote_valid` maps to quote validity state.
- `distance_from_atm` and `ln_kf` are preserved in normalized storage for future filtering and diagnostics.
- `contract_id` is derived consistently, for example `SPXW-2026-04-22-C-7005`.

The current `AnalyticsSnapshot` row contract does not expose open interest, `ln_kf`, or distance from ATM. Keep those fields in storage so the UI can add them later without reimport.

## Replay Assembly

`GET /api/spx/0dte/replay/snapshot?session_id=&at=` should:

1. Find the requested imported replay session.
2. Select the nearest preserved snapshot timestamp to `at`.
3. Load the normalized snapshot and all quote rows for that snapshot.
4. Calculate GammaScope custom analytics from bid/ask/spot/time.
5. Return an `AnalyticsSnapshot` with `mode: "replay"`.

Rows should include:

- `bid`, `ask`, and `mid` from normalized quote facts.
- `ibkr_iv` from source `iv`.
- `ibkr_gamma` and `ibkr_vanna` as `null` unless the source later provides those fields.
- `custom_iv`, `custom_gamma`, and `custom_vanna` from GammaScope analytics.
- `iv_diff` comparing `custom_iv` to `ibkr_iv` when both are available.
- `gamma_diff` as `null` unless a broker gamma is available.
- `calc_status` from quote validation and analytics calculation.
- `comparison_status` based on available broker comparison fields.

`GET /api/spx/0dte/replay/sessions` should include imported sessions after they complete successfully. Unknown or unpublished sessions should continue to return an empty replay snapshot shape rather than exposing partial data.

## Replay Edge Semantics

Replay snapshot selection should be deterministic:

- If `at` is missing, return the first preserved snapshot in the session.
- If `at` is earlier than the session start, return the first preserved snapshot.
- If `at` is later than the session end, return the last preserved snapshot.
- If two timestamps are equally near, choose the earlier timestamp.
- If the session id is unknown or not completed, return an empty `AnalyticsSnapshot` with `coverage_status: "empty"` and no rows.

## Import Lifecycle

Imports move through an explicit lifecycle:

- `uploaded`: files are received and archived, but not yet validated.
- `validating`: backend is checking schemas, row counts, joins, and data quality.
- `awaiting_confirmation`: validation passed with a summary ready for admin review.
- `publishing`: backend is writing normalized replay rows and preparing public replay metadata.
- `completed`: the replay session is visible through public replay APIs.
- `failed`: validation or publishing failed; the replay session is not public.
- `cancelled`: an admin discarded an unpublished import.

Only `completed` imports are visible through public replay APIs. Draft, failed, and cancelled imports remain admin-only.

## Website Import Flow

The admin website should expose an **Import Replay** button near replay controls. Public users should not see the button.

The import flow has four states:

1. Select files: upload `snapshots.parquet` and `quotes.parquet`, creating an import in `uploaded` or `validating` state.
2. Validate: backend inspects schemas, row counts, time range, expiry, and join coverage.
3. Confirm: UI shows a summary and warnings while the import is in `awaiting_confirmation`.
4. Complete: after admin confirmation, backend publishes normalized replay rows and links directly to the imported replay session.

The validation summary should show:

- trade date
- expiry
- time range
- snapshot count
- quote count
- quote rows per snapshot
- strike range
- valid quote count
- invalid quote count
- source file checksums
- duplicate-session warning when applicable

The UI should keep the flow operational rather than decorative: compact controls, explicit status, clear errors, and a direct handoff into replay.

## API Surface

Add import-specific admin APIs:

- `POST /api/replay/imports`: accepts the two Parquet files, archives them, and starts validation.
- `GET /api/replay/imports/{import_id}`: returns import status, validation summary, warnings, and errors.
- `POST /api/replay/imports/{import_id}/confirm`: publishes a validated import by writing normalized replay rows and marking the replay session public.
- `DELETE /api/replay/imports/{import_id}`: cancels an unpublished import.

The first implementation can run import synchronously if the request remains practical for local data size. If request timeouts or hosted limits become a problem, keep the same API shape but make import processing asynchronous with status polling.

`POST /api/replay/imports` should return:

- `import_id`
- `status`
- validation summary when available
- warnings
- errors

`GET /api/replay/imports/{import_id}` should return the same fields plus `session_id` and a replay-session link once completed.

`POST /api/replay/imports/{import_id}/confirm` should fail unless the import is in `awaiting_confirmation`. On success it returns `status: "completed"`, the `session_id`, and the replay-session link.

`DELETE /api/replay/imports/{import_id}` should fail with `409` for completed imports. Deleting completed public replay sessions is out of scope for this design.

Existing public replay APIs remain the playback surface:

- `GET /api/spx/0dte/replay/sessions`
- `GET /api/spx/0dte/replay/snapshot?session_id=&at=`

## Validation And Error Handling

Imports should fail before publishing a replay session when:

- either file is missing
- a file is not readable Parquet
- required columns are missing
- `snapshots.parquet` and `quotes.parquet` expiries do not match
- quote `snapshot_id` values do not map to snapshot rows
- the dataset has no snapshots
- the dataset has no valid quote rows
- symbol or expiry is outside the current SPX 0DTE scope

Imports may complete with warnings when:

- some quote rows are invalid or missing bid/ask
- some source IBKR IV values are missing
- snapshot intervals are irregular
- snapshot row counts differ from quote rows observed for that timestamp
- stale contract counts are nonzero
- a duplicate import is detected by checksum or session identity

Failed imports must not partially publish a replay session. Completed imports must remain available after refresh and server restart.

Duplicate imports should be idempotent by default. If the uploaded file checksums match an existing completed import, validation should return `awaiting_confirmation` with a duplicate warning and the existing `session_id`. Confirming that duplicate should not create a second public replay session; it should return the existing completed session link. A future version may add an explicit "import anyway as new session" action, but that is out of scope for the first version.

When checksums are unavailable or inconclusive, duplicate session identity should be derived from symbol, trade date, expiry, time range, snapshot count, quote count, and source row-count profile. Exact file checksum matches are authoritative; identity matches without checksum matches should remain warnings for admin review.

## Admin And Visibility Boundary

Only admin/developer users can import replay files. Public users can list and replay successfully imported sessions but cannot upload, modify, or delete imported files.

The first implementation uses a simple admin secret gate:

- Backend import endpoints require a configured admin token.
- Frontend upload controls render only when admin mode is enabled.
- Admin requests send the token through an explicit header, for example `X-GammaScope-Admin-Token`.
- Missing or invalid admin tokens return `403` without parsing uploaded files.
- Public replay endpoints do not require the token.

Local development can set the admin token through environment configuration. Hosted/public mode should hide import controls unless an admin session or configured secret enables them. This is intentionally lighter than full user accounts and matches the current light-auth direction.

## Testing Strategy

Backend tests should cover:

- Parquet schema validation.
- Missing file and corrupted file handling.
- Mismatched expiry handling.
- Join coverage between snapshot rows and quote rows.
- Import persistence across app restart or repository test client recreation.
- Exact source snapshot count preservation.
- Nearest-time replay selection, including missing `at`, out-of-range `at`, and equal-distance tie behavior.
- Mapping source `iv` to `ibkr_iv`.
- Recomputing `custom_iv`, `custom_gamma`, and `custom_vanna`.
- Invalid quote rows producing visible calculation status.
- Admin token enforcement on import endpoints.
- Completed sessions appearing in replay session lists.
- Failed imports not appearing in public replay session lists.
- Duplicate imports returning the existing completed session instead of publishing a second session.

Frontend tests should cover:

- Admin users can see the import button.
- Public users cannot see upload controls.
- Public users cannot submit import requests.
- Validation summary renders counts and warnings.
- Successful import links to the replay session.
- Replay screen can select an imported session and request preserved timestamps.

Contract tests should keep `AnalyticsSnapshot` as the frontend replay shape. If storage needs extra fields such as open interest or source metadata, those fields should remain internal until the schema intentionally expands.

## Implementation Notes

The FastAPI package will need a Parquet reader dependency. `pyarrow` is a practical default because it reads both schemas cleanly and supports efficient row-group access.

Storage can begin with a local persistent database compatible with the future Postgres direction. The design should avoid an in-memory-only import registry because the selected requirement is persistence after refresh and restart.

The existing uncommitted tests already point toward multi-snapshot replay behavior. Implementation should work with those expectations without reverting unrelated user edits.

## Open Decisions For Implementation Planning

- Exact persistent database choice for the first slice: SQLite for local speed or Postgres through the existing Docker Compose direction.
- Whether `POST /api/replay/imports` runs synchronously first or immediately uses a background job.
- How to index internal open interest and source diagnostics for future use. Do not add those fields to `AnalyticsSnapshot` in the first import slice.
