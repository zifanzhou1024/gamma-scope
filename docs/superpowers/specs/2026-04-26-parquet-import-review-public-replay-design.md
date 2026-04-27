# Parquet Import Review And Public Replay Design

Date: 2026-04-26
Status: Approved design and spec review
Repository: gamma-scope

## Summary

GammaScope should add a complete admin website flow for importing SPX 0DTE replay data from `snapshots.parquet` and `quotes.parquet`, reviewing the files before publish, confirming the import, and replaying the completed session through the existing dashboard. Completed imports are public read-only replay sessions. Upload, validation review, confirm, and cancel actions are admin-only.

The implementation should port the useful backend import/storage/parquet validation work from the existing `codex/parquet-replay-import` worktree into current `main`, then finish the missing pieces: current-architecture integration, website admin login, browser upload, replay snapshot assembly, and exact imported timestamp playback.

The two provided real parquet files should be available as a local development baseline when present, but they must not be committed to GitHub or bundled into a public deployment. Public deployments restore that replay by letting a predefined admin upload the same files through the website.

## Goals

- Add a predefined admin login for the website.
- Show import controls only to logged-in website admins.
- Accept exactly two browser-uploaded files: `snapshots.parquet` and `quotes.parquet`.
- Archive uploaded raw parquet files with checksums and metadata.
- Validate schemas, joins, expiry/trade-date consistency, quote quality, duplicate identity, and row counts before publish.
- Show a review screen with compact summary data plus representative first/middle/last snapshot previews.
- Publish confirmed imports into normalized replay storage.
- Expose completed imports through existing public replay APIs and dashboard controls.
- Preserve exact imported snapshot timestamps for imported sessions.
- Keep source `iv` as `ibkr_iv` and recompute GammaScope custom IV, gamma, and vanna.
- Keep the real April 22 parquet pair as an ignored local baseline for local testing when present.

## Non-Goals

- Do not commit the real parquet baseline files to the public repo.
- Do not include the real parquet files in public deployment artifacts.
- Do not add public upload access.
- Do not add full multi-user accounts, signup, password reset, or role management.
- Do not add a general data browser for every quote row in the first slice.
- Do not add completed-session deletion in this slice.
- Do not make imported replay depend on raw parquet files at runtime after publish.
- Do not expose internal source diagnostics such as `ln_kf` or distance-from-ATM in the public `AnalyticsSnapshot` contract yet.

## Current Project Context

Current `main` already has:

- Next.js dashboard with replay controls, scenario panel, saved views, option chain, charts, and WebSocket/polling paths.
- FastAPI backend with live snapshot assembly, replay routes, replay WebSocket, Postgres-backed replay capture, Redis latest-state cache, retention cleanup, and light private/admin token behavior.
- Shared `AnalyticsSnapshot` contract with custom analytics fields and IBKR comparison fields.
- A `docs/superpowers/specs/2026-04-24-parquet-replay-import-design.md` spec that selected normalized import storage plus raw archive.

The existing `codex/parquet-replay-import` worktree has useful but incomplete backend work:

- SQLite replay import storage that can inform table shape and lifecycle logic.
- Raw archive/checksum helpers.
- PyArrow parquet validation and normalization.
- Import lifecycle orchestration and duplicate detection.
- Tests for many parquet validation edge cases.

That worktree predates current `main`; it does not include current replay persistence, live dashboard, WebSocket replay, admin/private mode updates, website import UI, import API routes, or replay snapshot assembly. It should be ported selectively, not merged mechanically.

## Source Data Observed

The provided local files are:

- `/Users/sakura/Downloads/trade_date=2026-04-22 2/snapshots.parquet`
- `/Users/sakura/Downloads/trade_date=2026-04-22 2/quotes.parquet`

Observed file metadata:

- `snapshots.parquet`: 374,897 bytes, SHA-256 `3f8b025d47475c05ccc92220cbffe686d20ab680b69f08ebd94aabc48f99c587`
- `quotes.parquet`: 6,730,963 bytes, SHA-256 `628f64eedebc6935baa4087386baa1e46c9116fbde80681b59265a18dd169321`
- Snapshot rows: 15,787
- Quote rows: 1,294,534
- Quote rows per snapshot: exactly 82
- Time range: `2026-04-22T13:30:02Z` through `2026-04-22T19:59:58Z`
- Expiry: `20260422`, canonicalized to `2026-04-22`
- Snapshot ids: sequential source ids from `snapshots:0` through `snapshots:15786`
- Join coverage: every quote references a snapshot, and every snapshot has quotes
- Option rows: balanced calls and puts, 647,267 each
- Strike range: 6965 through 7240
- Unique strikes: 56
- Source `quote_valid` true rows: 1,014,501
- Rows usable under stricter valid quote logic, requiring `quote_valid` plus bid/ask/mid: 1,010,546
- Rows treated as invalid or missing quote under import normalization: 283,988
- IBKR/source IV missing rows: 387,210
- Open-interest missing rows: 259
- Duplicate `market_time` values: 14 timestamps have two snapshots
- Cadence: mostly one to two seconds, max observed gap seven seconds

Important import implications:

- Exact timestamp playback should preserve source snapshot order and source snapshot ids, because timestamp alone is not unique.
- The source `valid_mid_contract_count` matches quote-valid counts; source `row_count` appears to represent a different source quality metric and should be shown as source diagnostics, not used as the quote row count.
- Some source-valid rows are missing bid/ask/mid and should not be treated as calculable quote rows.
- Source `mid` is effectively bid/ask midpoint within float precision; GammaScope may compute/display its own mid from bid/ask for `AnalyticsSnapshot`, while retaining source mid internally.

## Selected Approach

Use Approach 1: port and finish the existing import branch.

The current import branch should be treated as a tested source of implementation material for:

- parquet schema validation
- raw archive metadata
- normalized import lifecycle
- duplicate detection
- source-to-normalized row mapping
- local baseline real-file smoke behavior

The implementation must adapt that work to current `main` rather than replacing current replay/live features. Current `main` is the target architecture.

## Local Baseline Policy

The real April 22 parquet pair should be copied only into an ignored local backend data directory, for example:

```text
.gammascope/replay-baselines/2026-04-22/snapshots.parquet
.gammascope/replay-baselines/2026-04-22/quotes.parquet
```

Implementation should add `.gammascope/` to `.gitignore` before any local baseline copy is made. The baseline files remain local machine data and are never staged or committed.

Local development behavior:

- If the ignored baseline files exist, local dev can use them as the default replay import baseline.
- A local helper can import the baseline idempotently into the local replay store.
- Optional real-file smoke tests use the baseline when present and skip when absent.
- CI must not require the real baseline files.
- Docs should explain how to copy the files locally from the provided Downloads path without adding them to Git.

Public deployment behavior:

- Public deployment artifacts do not contain the real parquet files.
- The public site can start with seeded replay data only.
- A predefined admin can upload the real parquet pair through the website to restore playback.
- Once confirmed, that uploaded import is archived in deployment storage and exposed as a public read-only replay session.

## Admin Model

Use a predefined website admin login plus the existing backend admin-token boundary.

Website admin:

- Credentials come from environment configuration, for example `GAMMASCOPE_WEB_ADMIN_USERNAME` and `GAMMASCOPE_WEB_ADMIN_PASSWORD`.
- Session signing uses `GAMMASCOPE_WEB_ADMIN_SESSION_SECRET`.
- The website exposes login/logout controls.
- Successful login creates an HTTP-only signed session cookie.
- Import controls render only when that session is valid.
- There is no signup, account management, password reset, or multi-user role model.

Website admin session behavior:

- If username, password, or session secret is missing, admin login is disabled, import controls stay hidden, and import proxy routes return `503` with a setup-oriented error.
- The cookie name is `gammascope_admin`.
- Cookie lifetime is eight hours.
- Cookie attributes are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever the request is HTTPS or a production/hosted environment flag is enabled.
- Logout clears the cookie.
- `GET /api/admin/session` returns whether the admin session is active and a CSRF token for unsafe admin actions.
- `POST /api/admin/login` is exempt from the existing-session and CSRF requirement because it creates the session.
- All other `POST`, `DELETE`, and file-upload admin routes require a same-origin admin session and an `X-GammaScope-CSRF` header matching the session CSRF token.
- Failed login responses do not reveal whether the username or password was wrong.

Website admin response bodies:

- Successful login: `200 { "authenticated": true }`
- Failed login: `401 { "authenticated": false, "error": "Invalid credentials" }`
- Login unavailable because admin env is missing: `503 { "authenticated": false, "error": "Admin login unavailable" }`
- Logout: `200 { "authenticated": false }`
- Authenticated session check: `200 { "authenticated": true, "csrf_token": "<token>" }`
- Unauthenticated session check: `200 { "authenticated": false, "csrf_token": null }`

Backend protection:

- FastAPI import endpoints require `X-GammaScope-Admin-Token` using the existing `GAMMASCOPE_ADMIN_TOKEN` model.
- Next.js import proxy routes can call FastAPI with the backend admin token only after verifying the website admin session.
- Public replay endpoints remain unauthenticated.
- Existing private/hosted replay behavior must not be loosened.

This keeps the website polished while retaining a backend safety boundary if the web proxy is misconfigured or bypassed.

## Storage Architecture

Use two storage layers.

### Raw Archive Layer

The raw archive stores uploaded `snapshots.parquet` and `quotes.parquet` files by import id. Postgres metadata for those archived files stores:

- import id
- import status
- derived session id
- source filenames
- file sizes
- SHA-256 checksums
- archive paths
- detected symbol and scope
- detected trade date and expiry
- time range
- row counts
- validation summary
- warnings and errors
- created and updated timestamps

Postgres owns import lifecycle/status metadata. The raw archive may include a copied manifest file for human inspection, but that manifest is not the source of truth. This avoids divergence between file storage and database state.

Local development archive storage:

- Use `GAMMASCOPE_REPLAY_ARCHIVE_DIR`, defaulting to an ignored local path under `.gammascope/`.
- Filesystem storage is acceptable locally.

Public deployment archive storage:

- Use a persistent volume or object-storage-backed mount configured by `GAMMASCOPE_REPLAY_ARCHIVE_DIR`.
- Do not rely on ephemeral serverless or container scratch storage for uploaded parquet archives.

The archive is for audit, debugging, duplicate detection, and reimport safety. It is not the runtime replay query source after publish. Completed replay must keep working from normalized Postgres rows even if raw archive access is temporarily unavailable. Revalidation or republishing actions that require the raw files should return a clear admin error if the archive is missing.

### Normalized Replay Import Layer

The normalized import layer stores:

- replay import lifecycle records
- public replay session metadata
- one snapshot record per source `snapshot_id`
- one quote record per source quote row
- exact timestamp/index metadata for imported sessions
- source diagnostics needed for review and future UI expansion

This layer should target Postgres because current `main` already uses Postgres for replay capture and the hosted replay path expects managed Postgres. The old branch's SQLite code should be ported as lifecycle and schema guidance, not as the production storage backend. Tests may still use repository test doubles where current project patterns allow them.

The imported replay tables should be separate enough from whole-payload replay capture that imported data can be reassembled and recalculated in the future without re-uploading raw parquet. The selected requirement is persistence across refresh and restart.

## Data Mapping

Session mapping:

- `session_id`: stable id, for example `replay-spx-0dte-2026-04-22-20260422-133002-<hash>`
- `symbol`: `SPX`
- `scope`: `0DTE`
- `expiry`: source `YYYYMMDD` canonicalized to `YYYY-MM-DD`
- `start_time`: earliest source snapshot time
- `end_time`: latest source snapshot time
- `snapshot_count`: source snapshot row count
- `quote_count`: source quote row count
- `source`: `parquet_import`
- `visibility`: `public` after successful confirm

Snapshot mapping:

- Source `snapshot_id` remains the traceability key.
- `market_time` maps to canonical snapshot time.
- `pricing_spot` is preferred for `spot` when finite and positive; otherwise use `spot`.
- `forward_price` maps to `forward`.
- `risk_free_rate` maps to the snapshot rate.
- `t_minutes` is retained for source diagnostics and can drive time-to-expiry for imported replay assembly.
- `selected_strike_count`, `valid_mid_contract_count`, `stale_contract_count`, and `row_count` are retained for review.
- `discount_factor` is computed from rate and time-to-expiry.
- `dividend_yield` may be inferred from spot, forward, rate, and time where needed for the existing Black-Scholes helper.

Quote mapping:

- Source `snapshot_id` joins to normalized snapshot record.
- `option_type` maps `C`/`call` to `call`, `P`/`put` to `put`.
- `strike`, `bid`, `ask`, `mid`, and quote validity are retained.
- Source `iv` maps to `ibkr_iv`.
- `oi` maps to internal/open-interest storage and to `AnalyticsSnapshot.open_interest`.
- `ln_kf` and `distance_from_atm` remain internal diagnostics.
- `contract_id` is derived consistently, for example `SPXW-2026-04-22-C-7105`.

Runtime analytics mapping:

- `custom_iv`, `custom_gamma`, and `custom_vanna` are recomputed by GammaScope from quote facts.
- `ibkr_gamma` and `ibkr_vanna` are `null` unless future source files include broker Greeks.
- `iv_diff` compares custom IV to source/IBKR IV when both exist.
- `gamma_diff` stays `null` without broker gamma.
- Invalid or missing quotes produce visible `calc_status` values.

## API Surface

Add website-facing Next.js routes for admin login and import proxying:

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/session`
- `POST /api/replay/imports`
- `GET /api/replay/imports/{import_id}`
- `POST /api/replay/imports/{import_id}/confirm`
- `DELETE /api/replay/imports/{import_id}`

Add FastAPI import routes behind `X-GammaScope-Admin-Token`:

- `POST /api/replay/imports`
- `GET /api/replay/imports/{import_id}`
- `POST /api/replay/imports/{import_id}/confirm`
- `DELETE /api/replay/imports/{import_id}`

Existing public replay APIs remain the playback surface:

- `GET /api/spx/0dte/replay/sessions`
- `GET /api/spx/0dte/replay/snapshot?session_id=&at=&source_snapshot_id=`
- `WS /ws/spx/0dte/replay?session_id=&at=&source_snapshot_id=&interval_ms=`

Add exact timestamp metadata for sessions that provide it. Extend replay session responses with:

- `timestamp_source`: `exact` or `estimated`
- `snapshot_count`

Add a separate public timestamp route for exact imported timestamps:

- `GET /api/spx/0dte/replay/sessions/{session_id}/timestamps`

The timestamp route returns `200` with:

- `session_id`
- `timestamp_source`
- `timestamps`: array of `{ index, snapshot_time, source_snapshot_id }`

Imported sessions return source-order exact timestamp entries. Sessions without exact metadata return `timestamp_source: "estimated"` and an empty `timestamps` array, and the frontend falls back to estimated timestamp options.

Import API response contracts:

- Upload returns `202` when validation is accepted and still processing, or `200` when validation completes synchronously.
- The first implementation may validate synchronously for local files of the observed size, but the response shape must support polling through the same `GET import` route.
- Upload response bodies always use `{ import_id, status, summary, warnings, errors, session_id, replay_url }` after an import record is created, including synchronous validation failures.
- `import_id` is always present in upload responses that create an import record so the UI can poll or inspect later.
- `GET import` returns `{ import_id, status, summary, warnings, errors, session_id, replay_url }`.
- `summary` includes the review fields listed in Website Experience.
- `warnings` and `errors` are arrays of user-readable strings.
- `replay_url` is present only when the import is completed.
- Confirm returns `200` with the same shape and `status: "completed"` when publish succeeds or duplicate idempotency resolves to an existing session.
- Cancel returns `200` with `status: "cancelled"` for unpublished imports.

Import API status and transition errors:

- Missing admin credentials/session/token returns `403`, except missing website admin env setup returns `503` on Next.js proxy routes.
- Missing import id returns `404`.
- Upload validation failures return `200` with `status: "failed"` and validation errors after the import record is created.
- Malformed multipart requests, missing required file fields, extra multipart fields, wrong filenames, duplicate same-file uploads, oversized uploads, or interrupted uploads return `400` or `413` before an import record is created.
- Swapped file contents with otherwise correct field names and filenames create an import record, archive the files, then fail schema validation with `200` and `status: "failed"`.
- Confirming an import in `completed` returns `200` with the existing completed session; confirming any other import outside `awaiting_confirmation` returns `409`.
- Cancelling a completed import returns `409`.
- Cancelling a publishing import returns `409`.
- Deleting completed public replay sessions is out of scope.

## Replay Semantics

Imported replay snapshot selection:

- If `source_snapshot_id` is provided for an imported session, select that exact normalized snapshot id.
- If `source_snapshot_id` is unknown for the session, return an empty replay snapshot shape with `coverage_status: "empty"`.
- If no `source_snapshot_id` is provided and no `at` is provided, return the first imported snapshot.
- If no `source_snapshot_id` is provided and `at` is before the session, return the first imported snapshot.
- If no `source_snapshot_id` is provided and `at` is after the session, return the last imported snapshot.
- If no `source_snapshot_id` is provided and `at` falls between snapshots, return the nearest snapshot.
- If no `source_snapshot_id` is provided and two snapshots are equally near, choose the earlier timestamp.
- If no `source_snapshot_id` is provided and two snapshots share the same timestamp, choose the earlier source-order snapshot.
- Unknown or unpublished sessions return an empty replay snapshot shape rather than exposing draft data.

Replay streaming:

- Existing replay WebSocket should work for imported sessions.
- Streaming starts at the exact `source_snapshot_id` when supplied.
- If no `source_snapshot_id` is supplied, streaming starts at the first snapshot at or after the requested `at`.
- Imported sessions stream in exact normalized snapshot order.
- Public replay streaming does not require admin login.

Frontend scrubber:

- Imported sessions use exact timestamp options.
- For imported sessions, the frontend sends `source_snapshot_id` along with `session_id` when loading or streaming a selected timestamp so duplicate timestamps remain selectable.
- Seed and existing persisted live-capture sessions may keep the current start/end/count approximation unless exact timestamps are available.
- The UI should not assume every replay session has evenly spaced timestamps.

## Website Experience

Public users:

- Can see existing dashboard, replay controls, scenario panel, saved views, and completed replay sessions.
- Can replay completed imported sessions.
- Cannot see upload controls.
- Cannot create, confirm, or cancel imports.

Admin users:

- Log in with predefined credentials.
- See an **Import Replay** control near replay controls.
- Select exactly `snapshots.parquet` and `quotes.parquet`.
- Upload files and wait for validation.
- Review import summary before publishing.
- Confirm or cancel unpublished imports.
- After confirm, replay sessions refresh and the imported session is selected.
- Can log out, hiding import controls again.

Upload contract:

- The multipart request must include exactly two file fields: `snapshots` and `quotes`.
- The uploaded filenames must be `snapshots.parquet` and `quotes.parquet`.
- Extra file fields and extra non-file multipart fields fail before validation.
- Supplying the same file for both fields fails before validation when checksums match.
- Swapped roles fail schema validation because required snapshot and quote columns differ.
- Maximum upload size is controlled by `GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES`, defaulting to 100 MB per file.
- Oversized or interrupted uploads fail without creating a public replay session.

Review screen fields:

- trade date
- expiry
- time range
- snapshot count
- quote count
- quote rows per snapshot
- valid and invalid quote counts
- strike range
- file sizes
- file checksums
- duplicate warnings
- validation warnings and errors
- first, middle, and last snapshot previews with timestamp, spot, forward, valid/stale counts, and row-count diagnostics

The review UI should be operational and compact. It should not become a full quote-row workbench in this slice.

## Import Lifecycle

Imports move through these states:

- `uploaded`: files received and archive record created.
- `validating`: backend is reading schemas and building validation summary.
- `awaiting_confirmation`: validation passed and admin review is available.
- `publishing`: backend is writing normalized replay rows.
- `completed`: replay session is public read-only.
- `failed`: validation or publishing failed; no public session is visible.
- `cancelled`: admin discarded an unpublished import.

Only `completed` imports appear in public replay session lists.

Allowed actions:

| State | GET status | Confirm | Cancel | Public replay visible |
| --- | --- | --- | --- | --- |
| `uploaded` | yes | `409` | yes | no |
| `validating` | yes | `409` | yes | no |
| `awaiting_confirmation` | yes | yes | yes | no |
| `publishing` | yes | `409` | `409` | no |
| `completed` | yes | idempotent `200` | `409` | yes |
| `failed` | yes | `409` | yes | no |
| `cancelled` | yes | `409` | idempotent `200` | no |

Duplicate behavior:

- Exact checksum duplicates of a completed import are idempotent.
- Confirming a duplicate should return the existing completed session.
- Duplicate identity without checksum match should warn for admin review.
- Same start/end/count is not enough for duplicate identity; identity should include source row-count profile and snapshot time profile.

Publishing behavior:

- Publishing must be transactional.
- A failed publish must not leave a partial public session.
- A failed import can be retried by starting a new upload from the same files; duplicate detection prevents creating extra completed sessions.
- Recovery of stale `publishing` records is an internal maintenance concern and must not make a partial session public.

## Error Handling

Validation fails before publish when:

- either uploaded file is missing
- extra file fields are provided
- filenames do not match the required `snapshots.parquet` and `quotes.parquet` names
- the same file is supplied for both upload fields
- uploads exceed configured size limits
- uploads are interrupted or malformed
- either file is unreadable or corrupt parquet
- required columns are missing
- snapshot ids are missing, blank, or duplicated
- quote `snapshot_id` values do not map to snapshot rows
- snapshot and quote expiries mismatch
- expiry is not the same date as the 0DTE market data
- source data is outside current SPX 0DTE scope
- no snapshot rows exist
- no usable quote rows exist
- numeric, boolean, or timestamp fields cannot be parsed safely

Validation may pass with warnings when:

- some quotes are invalid or missing bid/ask/mid
- some IBKR/source IV values are missing
- quote cadence is irregular
- duplicate snapshot timestamps exist but source ids preserve order
- stale counts are nonzero
- duplicate imports are detected

Runtime replay errors:

- Unknown session ids return empty replay snapshot shape.
- Draft, failed, and cancelled imports never appear in public replay.
- Backend persistence unavailability should degrade to seed replay for public demos where existing behavior already does so, while admin import actions return clear errors.

## Testing Strategy

Backend tests:

- Parquet schema validation and corrupt-file handling.
- Missing file, missing required column, invalid type, invalid timestamp, non-finite numeric, and invalid boolean cases.
- Expiry/trade-date mismatch.
- Snapshot/quote join coverage.
- Duplicate snapshot ids and duplicate normalized quote identities.
- Invalid quote warnings.
- Source `iv` maps to `ibkr_iv`.
- Custom analytics recomputation from normalized quote facts.
- Import lifecycle transitions.
- Duplicate checksum and duplicate identity behavior.
- Transactional publish failure behavior.
- Admin token enforcement on FastAPI import endpoints.
- Completed imports appear in public replay session lists.
- Failed, draft, and cancelled imports do not appear publicly.
- Exact timestamp replay selection, duplicate timestamp ordering, and equal-distance tie behavior.
- Replay WebSocket streaming for imported sessions.

Frontend tests:

- Public users do not see import controls.
- Admin login shows import controls; logout hides them.
- Upload sends exactly the two selected files.
- Review summary renders counts, warnings, checksums, and first/middle/last snapshots.
- Confirm refreshes sessions and selects the imported replay.
- Imported exact timestamp sessions use exact scrubber options.
- Sessions without exact timestamp metadata continue using estimated timestamp options.

Real-file smoke tests:

- If `.gammascope/replay-baselines/2026-04-22/snapshots.parquet` and `quotes.parquet` exist, validate and optionally import them.
- If the files are absent, skip with a clear message.
- CI should not fail because the real files are absent.

Verification should keep existing contract, API, collector, and web tests passing.

## Implementation Notes

- Add `pyarrow` and `python-multipart` to backend dependencies.
- Add `.gammascope/` to `.gitignore` before creating the local baseline directory.
- Avoid adding the parquet files to fixtures or any tracked repo path.
- Prefer structured parquet reads and batch quote scanning rather than reading quote rows through ad hoc string parsing.
- Keep `AnalyticsSnapshot` as the frontend replay shape.
- Keep source diagnostics internal until a separate UI expansion intentionally exposes them.
- Use the current dashboard style: compact, operational controls rather than a marketing page or full data-workbench UI.
- Treat the old import branch as source material, but preserve current `main` behavior for replay capture, WebSockets, saved views, scenario, and private/hosted replay modes.

## Approval Criteria

- Local admin can upload the two parquet files through the website, review validation, confirm, and replay the imported session.
- Public users can replay completed imports but cannot upload or confirm imports.
- Imported sessions preserve exact source timestamps.
- Local ignored baseline files can power local smoke tests and default development playback when present.
- The real parquet files are not committed or required in CI.
- Existing seed replay behavior continues to work when no imported session exists.
