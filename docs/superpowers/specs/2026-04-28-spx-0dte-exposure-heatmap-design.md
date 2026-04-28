# SPX 0DTE Exposure Heatmap Design

Date: 2026-04-28
Status: Approved design
Repository: gamma-scope

## Summary

GammaScope will add a separate SPXW 0DTE exposure heatmap surface backed by a dedicated FastAPI heatmap API and Postgres persistence. The first UI will be a latest-only vertical strike ladder with one active metric column, GEX or VEX, plus node summaries and center controls. The backend will still persist every computed heatmap snapshot and maintain 5-minute bucket records for fast future retrieval.

This work must preserve the existing realtime dashboard, replay dashboard, scenario flow, saved views, and Moomoo collector path. The heatmap should be isolated behind a new `/heatmap` page and new `/api/spx/0dte/heatmap/latest` backend route.

## Goals

- Build a Skylit-like SPXW 0DTE exposure heatmap independently from licensed/local data and GammaScope code.
- Add a dedicated backend heatmap API instead of calculating exposure only in the frontend.
- Use the current Moomoo-driven `AnalyticsSnapshot` as the first data source.
- Use Moomoo open interest captured at or after 09:25 New York time as the daily OI baseline.
- Compute signed OI-proxy GEX and VEX by strike.
- Persist every computed heatmap snapshot to Postgres for future replay/research.
- Maintain 5-minute bucket records in Postgres for fast future history retrieval.
- Render a focused latest-ladder heatmap page with GEX/VEX toggle, node badges, color intensity, live/stale labels, and centering controls.
- Clearly label output as OI proxy / estimated dealer exposure.

## Non-Goals

- Do not integrate the heatmap into replay UI or replay APIs in the first implementation.
- Do not add multi-symbol heatmap panels for SPY, QQQ, RUT, NDX, or IWM in this slice.
- Do not replace the current dashboard charts or option chain.
- Do not generalize the existing collector event schema in this slice.
- Do not add trade-flow-adjusted dealer inventory yet.
- Do not copy Skylit branding, proprietary data, exact UI assets, or private code.

## Current Project Context

The repo already has the pieces needed for the first heatmap slice:

- Moomoo is the default live-source direction.
- The Moomoo collector publishes SPX compatibility events into the current collector ingestion path.
- `AnalyticsSnapshot` already carries SPX spot, expiry, bid, ask, mid, open interest, custom IV, custom gamma, custom vanna, provider IV, provider gamma, freshness, coverage, and status.
- FastAPI serves `/api/spx/0dte/snapshot/latest` and streams live snapshots over WebSocket.
- The web app already has realtime and replay dashboards and a disabled Heatmap nav tab.
- Postgres repository patterns exist for replay snapshots, replay imports, and saved views.

The heatmap should reuse these contracts and patterns while adding its own API response shape and persistence tables.

## Selected Approach

Use a dedicated heatmap API derived from live analytics snapshots, with Postgres persistence for full snapshots and 5-minute buckets.

Flow:

```text
Moomoo OpenD
  -> Moomoo collector
  -> Existing collector ingestion
  -> AnalyticsSnapshot
  -> Heatmap builder
  -> Heatmap Postgres repository
  -> Heatmap API
  -> /heatmap page
```

Alternatives considered:

- Extend `AnalyticsSnapshot` with heatmap fields. This would simplify frontend fetches, but it would bloat the main dashboard contract and risk disturbing working replay/scenario/dashboard behavior.
- Compute heatmap mostly in the frontend from `/snapshot/latest`. This is fast for visual prototyping, but it does not satisfy the backend API requirement and makes durable history awkward.
- Build latest plus full history/replay UI immediately. This is more complete, but too broad for the first heatmap slice.

The selected approach keeps the current app stable, gives heatmap its own contract, and stores enough data for later replay and history work.

## Position Model

The first implementation uses signed OI proxy mode only.

For each contract:

```text
call q = +baseline_open_interest
put  q = -baseline_open_interest
```

This is an estimate, not true dealer inventory. Every API payload and UI surface must label it as:

```text
OI proxy / estimated dealer exposure
```

Future position modes can add magnitude-only and flow-adjusted dealer estimates, but they are not part of the first implementation.

## Moomoo OI Baseline

Moomoo updates open interest around 09:25 New York time. The heatmap must use that morning OI baseline for intraday exposure calculations, instead of blindly using whatever `open_interest` appears on each later snapshot.

Baseline rules:

- Compute market date in `America/New_York`.
- Track SPXW contracts for the active 0DTE expiry.
- Capture and persist the first usable OI snapshot at or after 09:25 New York time for that market date.
- Use that baseline OI for all heatmap calculations during the day.
- If the 09:25 baseline is not available yet, use latest available OI as a temporary baseline and return `oiBaselineStatus: "provisional"`.
- Once baseline is captured, return `oiBaselineStatus: "locked"` and keep using it for that expiry/session.
- Missing baseline OI for a contract contributes zero exposure for that side and adds a row tag such as `missing_oi_baseline`.

The first implementation can lock the baseline opportunistically when the heatmap API is called. A later worker can make the capture proactive.

## Exposure Calculations

GEX is dollar hedge-notional change for a 1% SPX move:

```text
gex_1pct = q * multiplier * gamma * spot^2 * 0.01
```

VEX is dollar hedge-notional change for a one volatility point move:

```text
vex_1vol = q * multiplier * spot * vanna_per_vol_point
```

Gamma and vanna should use GammaScope custom analytics first:

- `custom_gamma` is gamma per one SPX index point.
- `custom_vanna` is already display-normalized per one volatility point.
- `multiplier` is 100 for SPX.

Aggregate by strike:

- `callValue`: sum call-side exposure at that strike.
- `putValue`: sum put-side exposure at that strike.
- `value`: `callValue + putValue`.
- Rows with missing Greek or missing baseline OI should skip that contract and carry data-quality tags.

## Node Detection

The backend should compute nodes for every heatmap payload:

- `king`: row with largest absolute active metric value.
- `positiveKing`: row with largest positive active metric value.
- `negativeKing`: row with most negative active metric value.
- `aboveWall`: closest strike above spot whose absolute value is at or above the 80th percentile of absolute values.
- `belowWall`: closest strike below spot whose absolute value is at or above the 80th percentile of absolute values.

Gamma flip is useful but out of scope for the first implementation.

## Color Normalization

The backend owns color normalization so frontend styling remains simple and consistent.

Use percentile scaling:

```text
scale_base = percentile(abs(values), 95)
colorNorm = min(1, sqrt(abs(value) / scale_base))
```

If all values are zero or missing, `colorNorm` should be `0`.

Color semantics:

- Positive exposure uses cool-to-bright green/yellow strength.
- Negative exposure uses blue/purple-to-deep-purple strength.
- Neutral or missing values use muted gray.

The frontend maps `value` sign plus `colorNorm` to CSS classes or CSS variables.

## API Contract

Add backend route:

```http
GET /api/spx/0dte/heatmap/latest?metric=gex
GET /api/spx/0dte/heatmap/latest?metric=vex
```

`metric` defaults to `gex` and accepts `gex` or `vex`.

Response shape:

```json
{
  "symbol": "SPX",
  "tradingClass": "SPXW",
  "dte": 0,
  "expirationDate": "2026-04-28",
  "spot": 7173.91,
  "metric": "gex",
  "positionMode": "oi_proxy",
  "oiBaselineStatus": "locked",
  "oiBaselineCapturedAt": "2026-04-28T13:25:02Z",
  "lastSyncedAt": "2026-04-28T14:00:44Z",
  "isLive": true,
  "isStale": false,
  "persistenceStatus": "persisted",
  "rows": [
    {
      "strike": 7175,
      "value": -31800000,
      "formattedValue": "-$31.8M",
      "callValue": 12000000,
      "putValue": -43800000,
      "colorNorm": 1,
      "tags": ["king", "near_spot"]
    }
  ],
  "nodes": {
    "king": { "strike": 7175, "value": -31800000 },
    "positiveKing": { "strike": 7200, "value": 12400000 },
    "negativeKing": { "strike": 7175, "value": -31800000 },
    "aboveWall": { "strike": 7200, "value": 12400000 },
    "belowWall": { "strike": 7150, "value": 8100000 }
  }
}
```

If the latest live snapshot is unavailable, private mode rules should mirror existing latest snapshot behavior: return a seed-derived or empty heatmap only when live state is not readable, and make that state visible through `isLive`, `isStale`, and `persistenceStatus`.

## Persistence

Use Postgres only.

Recommended tables:

```sql
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
```

```sql
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
```

```sql
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
```

```sql
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
```

Indexes should support latest and future history lookup:

- `heatmap_snapshots (session_id, source_snapshot_time DESC)`
- `heatmap_cells (heatmap_snapshot_id, strike)`
- `heatmap_bucket_5m (session_id, bucket_start DESC, position_mode)`
- `heatmap_oi_baselines (market_date, expiration_date, strike)`

Full `heatmap_snapshots` and `heatmap_cells` are the replay-ready source of truth. `heatmap_bucket_5m` is a fast retrieval layer that points to or stores the latest snapshot in each 5-minute bucket.

If Postgres is unavailable, the heatmap API should still return the latest computed payload from live state and set `persistenceStatus: "unavailable"`.

## Backend Modules

Add:

```text
apps/api/gammascope_api/heatmap/
  __init__.py
  exposure.py
  nodes.py
  normalization.py
  repository.py
  service.py
```

Responsibilities:

- `exposure.py`: signed OI proxy GEX/VEX calculations and money formatting.
- `nodes.py`: king, positive/negative king, above/below wall detection.
- `normalization.py`: percentile scaling, row tags, market-date helpers.
- `repository.py`: Postgres schema, OI baseline persistence, raw heatmap snapshots, cells, and 5-minute bucket upsert.
- `service.py`: build heatmap payload from `AnalyticsSnapshot`, coordinate baseline lookup/locking, persist payload.

Add route:

```text
apps/api/gammascope_api/routes/heatmap.py
```

Include it in `apps/api/gammascope_api/main.py`.

## Frontend Design

Add a separate page:

```text
apps/web/app/heatmap/page.tsx
```

The disabled Heatmap nav item should become an active link to `/heatmap`.

First-run UI:

- Header: `SPX 0DTE Exposure Heatmap`, SPXW, spot, expiry, live/stale state, last synced time.
- Toolbar: `GEX` and `VEX` toggle, `Center spot`, `Center king`, and range selector such as `+/-100 / +/-250 / +/-500 / all`.
- Main ladder: one row per strike, one active exposure column, mono strike/value text, sign-aware color intensity.
- Node panel: king, positive king, negative king, above-spot wall, below-spot wall, OI baseline status.
- Row markers: spot row, king badge, above/below wall badges, missing-data tags.
- Disclosure: "OI proxy / estimated dealer exposure, baseline OI from 09:25 ET."
- Data states: loading, no live snapshot, provisional OI baseline, stale data, persistence unavailable.

The reference screenshot has three panels, but GammaScope should start with only the SPXW panel. Additional panels can be added later if the data model becomes multi-symbol.

Frontend modules:

```text
apps/web/lib/clientHeatmapSource.ts
apps/web/lib/heatmapFormat.ts
apps/web/components/ExposureHeatmap.tsx
apps/web/components/HeatmapToolbar.tsx
apps/web/components/HeatmapNodePanel.tsx
```

The frontend should use `colorNorm` from the API and should not duplicate percentile scaling logic.

## Next.js Proxy

If the web app cannot call FastAPI directly from the server component in the same style as existing snapshot loading, add a proxy route:

```text
apps/web/app/api/spx/0dte/heatmap/latest/route.ts
```

The proxy should forward query parameters to:

```text
http://127.0.0.1:8000/api/spx/0dte/heatmap/latest
```

It should follow the same error-handling style as existing app API proxy routes.

## Error Handling

Handle these states explicitly:

- No live analytics snapshot.
- Snapshot is not 0DTE by New York market date.
- Missing or provisional OI baseline.
- Missing `custom_gamma` or `custom_vanna`.
- Missing open interest for one or both sides.
- Postgres unavailable.
- Stale source snapshot.
- Empty chain coverage.

The UI should not hide these states. It should render a usable page with clear labels when data is partial or provisional.

## Testing

Backend tests:

- GEX formula uses signed OI proxy and SPX multiplier.
- VEX formula uses custom vanna per volatility point.
- Missing OI or missing Greek contributes zero and adds tags.
- OI baseline is provisional before 09:25 baseline capture and locked after first usable post-09:25 snapshot.
- Baseline lookup uses New York market date.
- King, positive king, negative king, above wall, and below wall are detected correctly.
- Percentile/square-root color normalization handles large outliers and all-zero values.
- Repository creates schema, upserts full snapshots, dedupes by `session_id + source_snapshot_time + position_mode`, inserts cells, and updates 5-minute buckets.
- Route returns latest GEX/VEX payloads and `persistenceStatus: "unavailable"` when repository persistence fails.

Frontend tests:

- `/heatmap` renders the title, spot, expiry, GEX/VEX toggle, status labels, and disclosure.
- Metric toggle requests or displays the selected metric.
- Rows show formatted exposure values, sign-based classes, and node badges.
- Provisional baseline, stale data, and persistence-unavailable states are visible.
- Heatmap nav item links to `/heatmap` and marks active state.
- Center spot and center king controls are present and wired to scroll targets.

Verification commands should include:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_heatmap_*.py -q
pnpm --filter @gammascope/web test -- --run Heatmap
pnpm typecheck:web
```

## Implementation Phases

1. Add backend heatmap calculation modules and pure unit tests.
2. Add Postgres repository with OI baseline, raw snapshots, cells, and 5-minute buckets.
3. Add heatmap service and `/api/spx/0dte/heatmap/latest`.
4. Add web client fetcher and optional Next.js proxy route.
5. Add `/heatmap` page and activate the Heatmap nav link.
6. Add component styles and frontend tests.
7. Run targeted backend and frontend verification.

## Acceptance Criteria

- `/api/spx/0dte/heatmap/latest?metric=gex` returns a normalized heatmap payload.
- `/api/spx/0dte/heatmap/latest?metric=vex` returns the same shape with VEX values.
- Heatmap calculations use the 09:25 New York Moomoo OI baseline when locked.
- Before baseline lock, the API marks OI as provisional.
- Every computed heatmap snapshot is persisted to Postgres when available.
- 5-minute bucket rows are maintained for fast future history retrieval.
- `/heatmap` displays a latest SPXW strike ladder with sign/strength color intensity.
- The page includes GEX/VEX toggle, spot and king centering controls, node panel, live/stale status, last sync, and OI proxy disclosure.
- Existing realtime dashboard, replay dashboard, and scenario behavior remain unaffected.
