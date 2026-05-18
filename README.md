# GammaScope

GammaScope is a local-first SPX/0DTE analytics workspace with a FastAPI backend,
a Next.js dashboard, collector adapters, replay storage, and a new local ML
research recorder. The current live-source direction is Moomoo OpenD. IBKR
commands remain in the repo as local smoke/probe tools, but new collection work
should start from the Moomoo sections below.

Current high-level surfaces:

- Web dashboard: `http://localhost:3000`
- API: `http://127.0.0.1:8000`
- Public live snapshot smoke endpoint: `GET /api/spx/0dte/snapshot/latest`
- Moomoo dashboard collector: `pnpm collector:moomoo-snapshot`
- Moomoo ML research recorder: `pnpm collector:moomoo-research-record`
- Automatic market-hours recorder wrapper:
  `ops/run_moomoo_research_market.sh`
- Local ML data root:
  `/Users/sakura/local-ml-data/gamma-ml-research`

Detailed Moomoo ML recorder documentation is in
[docs/ml-moomoo-research-recorder.md](docs/ml-moomoo-research-recorder.md).
Remote AMH/Nginx deployment notes are in
[docs/amh-nginx-server-setup.md](docs/amh-nginx-server-setup.md).

## Local Development

GammaScope uses a local pnpm monorepo plus a Python virtualenv for API and
collector code. Project-specific setup notes:

Deployment notes for the current Moomoo-backed dashboard and heatmap stack are in [docs/deployment.md](docs/deployment.md). For the AMH/Nginx remote server layout where your computer publishes Moomoo data to a server-hosted backend and frontend, use [docs/amh-nginx-server-setup.md](docs/amh-nginx-server-setup.md).

Run:

    pnpm install
    pnpm contracts:validate
    pnpm contracts:generate
    docker compose up -d
    python3 -m venv .venv
    .venv/bin/python -m pip install -e "apps/api[dev]"
    pnpm test

### Verification

    pnpm install
    pnpm contracts:validate
    pnpm contracts:generate
    pnpm --filter @gammascope/contracts typecheck:generated
    python3 -m venv .venv
    .venv/bin/python -m pip install -e "apps/api[dev]"
    pnpm typecheck:web
    pnpm test:web
    .venv/bin/pytest apps/api/tests -q

Run local services:

    docker compose up -d
    pnpm dev:web
    .venv/bin/python -m uvicorn gammascope_api.main:app --reload --app-dir apps/api

Open the local dashboard at `http://localhost:3000`. The dashboard reads the
stable SPX 0DTE analytics contract. With live collector state available it shows
live mode; otherwise it falls back to seeded replay data.

## Data And Recorder Map

The repo now has two separate Moomoo collection paths:

| Purpose | Command | Storage/Output |
| --- | --- | --- |
| Dashboard compatibility collector | `pnpm collector:moomoo-snapshot -- --publish` | Publishes SPX-shaped collector events to the FastAPI ingestion path. |
| Local ML raw recorder | `pnpm collector:moomoo-research-record` | Writes append-only JSONL under `/Users/sakura/local-ml-data/gamma-ml-research/moomoo/`. |

The ML recorder is raw-first. It records 0DTE ATM-window option snapshots for:

```text
SPX, SPY, QQQ, IWM, RUT, NDX
```

Rows use the shared future training labels:

```text
time_utc
time_bucket_utc
ticker
```

Compatibility aliases are also written:

```text
captured_at_utc == time_utc
timeline_bucket_utc == time_bucket_utc
symbol == ticker
```

Canonical ticker names are provider-independent. Moomoo codes such as
`US..SPX`, option families such as `SPXW`, and contract codes stay in
source-specific fields such as `owner_code`, `option_code`, or `raw`; they do
not replace top-level `ticker`.

Local ML file layout:

```text
/Users/sakura/local-ml-data/gamma-ml-research/
  moomoo/
    options/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    underlyings/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    batches/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    captures/date=YYYY-MM-DD/captures.jsonl
  gexbot/
    responses/date=YYYY-MM-DD/ticker=SPX/endpoint=<endpoint-id>/records.jsonl
    captures/date=YYYY-MM-DD/captures.jsonl
  logs/
```

The `gexbot/` folders are reserved for the companion Dealer Flow Lab recorder.
The implementation handoff for that side lives in:

```text
/Users/sakura/WebstormProjects/dealer-flow-lab/docs/gexbot-ml-local-recorder-handoff.md
```

Future preprocessing should join Moomoo and GEXBot with:

```text
market_date + ticker + time_bucket_utc
```

Use backward/as-of joins only. Do not create model labels or train/test splits in
the raw collectors.

### Mock Local Collector

For deterministic local smoke tests, the mock collector can emit an SPX 0DTE
event cycle as newline-delimited JSON:

    pnpm collector:mock -- --spot 5200.25 --expiry 2026-04-23 --strikes 5190,5200,5210

The mock output uses the same normalized collector event contract consumed by
the local ingestion path.

### Local Collector Ingestion

The API can accept one normalized collector event at a time during local testing:

    POST /api/spx/0dte/collector/events
    GET  /api/spx/0dte/collector/state

For now this keeps the latest collector health, contracts, underlying ticks, and option ticks in process memory for live snapshot assembly.

Replay capture now persists replay-ready analytics snapshots to local Postgres when a valid live collector snapshot is available. The API uses:

    GAMMASCOPE_DATABASE_URL=postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope
    GAMMASCOPE_REPLAY_CAPTURE_INTERVAL_SECONDS=5
    GAMMASCOPE_REPLAY_RETENTION_DAYS=20
    GAMMASCOPE_SAVED_VIEW_RETENTION_DAYS=90

If Postgres is unavailable, collector ingestion still works and replay falls back to the seeded demo session.

With the API running, publish the mock collector cycle into that ingestion endpoint:

    pnpm dev:api
    pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210

Then inspect the live-mode analytics snapshot assembled from the ingested collector state:

    curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | python -m json.tool

To test the dashboard against local API state, run the API, publish the mock cycle, then start the web app with the API base URL:

    pnpm dev:api
    pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210
    GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 pnpm dev:web

Open `http://localhost:3000`. After the mock publish populates API state, the dashboard should show Live mode; if the API is unavailable, the web app falls back to the seeded replay snapshot. After page load, the dashboard connects to `ws://127.0.0.1:8000/ws/spx/0dte` for live snapshot updates and falls back to once-per-second polling if the WebSocket is unavailable. Set `NEXT_PUBLIC_GAMMASCOPE_WS_URL` when the WebSocket endpoint is not on the default local API host.

The dashboard also includes lightweight saved views for local testing. Saved views are validated against the shared contract, proxied through the Next.js app, and persisted in Postgres using `GAMMASCOPE_DATABASE_URL` when available. If the Postgres-backed repository is unavailable at runtime, the FastAPI route falls back to in-memory saved views so local dashboard flows keep working.

### Private Mode

By default GammaScope keeps local development open: collector ingestion, live snapshots, live WebSocket updates, replay, scenarios, and saved views work without an admin token.

Set private mode when the API may be reachable by non-admin users:

    GAMMASCOPE_PRIVATE_MODE_ENABLED=true
    GAMMASCOPE_ADMIN_TOKEN=local-admin-token
    pnpm dev:api

`GAMMASCOPE_PRIVATE_MODE=true` is also accepted. Truthy values are `1`, `true`, `yes`, `on`, and `enabled`.

In private mode, public viewing remains open. Live snapshots, live status, scenarios, live WebSocket updates, replay, heatmap, and experimental analytics do not require an admin token:

    curl -s http://127.0.0.1:8000/api/spx/0dte/replay/sessions | python -m json.tool
    curl -s "http://127.0.0.1:8000/api/spx/0dte/replay/snapshot?session_id=seed-spx-2026-04-23" | python -m json.tool
    curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | python -m json.tool

Collector ingestion, raw collector state, replay imports, and maintenance/admin operations require the admin token:

    curl -s -H "X-GammaScope-Admin-Token: local-admin-token" \
      http://127.0.0.1:8000/api/spx/0dte/collector/state | python -m json.tool

Saved-view public requests list only `owner_scope: "public_demo"`; creating or listing admin scoped views requires the admin token. If `GAMMASCOPE_ADMIN_TOKEN` is unset or blank, private admin operations return `403`.

### Local IBKR Health Probe

Check whether a local TWS or IB Gateway TCP endpoint is reachable:

    pnpm collector:ibkr-health

With the API running, publish that single `CollectorHealth` event into the local ingestion endpoint:

    pnpm collector:ibkr-health -- --publish

This is only a TCP reachability health probe. It does not perform a full IBKR API handshake, subscribe to market data, or discover option chains yet.

### Local IBKR API Handshake

The TCP probe only checks that a socket is reachable:

    pnpm collector:ibkr-health -- --port 4002

The API handshake command connects through the official IBKR `EClient`/`EWrapper` API and waits for `nextValidId`:

    pnpm collector:ibkr-handshake -- --port 4002

With the API running, publish that single handshake status event into local ingestion:

    pnpm collector:ibkr-handshake -- --port 4002 --publish

The handshake requires the official `ibapi` package in the project venv and IB Gateway or TWS API access enabled. A handshake timeout is reported as `stale`, because the TCP connection may exist while the API readiness callback has not arrived. This slice still does not subscribe to market data or discover SPX option chains.

### Local IBKR SPX 0DTE Contract Discovery

Discover the SPX 0DTE option contracts available from a local IB Gateway or TWS session:

    pnpm collector:ibkr-contracts -- --port 4002

By default the target expiry is the local calendar date. On weekends and market holidays, that can return zero contracts; pass an explicit trading date for local smoke tests:

    pnpm collector:ibkr-contracts -- --port 4002 --expiry 2026-04-24

The command resolves the SPX underlying, requests SPX/SPXW option metadata, prefers SPXW when same-expiry metadata exists, filters strikes around spot, resolves concrete option contract IDs, and prints a JSON object with `session_id`, `symbol`, `target_expiry`, `spot`, `contracts_count`, and `events`.

Useful controls:

    pnpm collector:ibkr-contracts -- --expiry 2026-04-24 --spot 5202 --strike-window-points 100 --max-strikes 21

`--spot` skips live SPX market data lookup. Without it, the collector requests a snapshot and uses last, midpoint, mark, or close in that order. `--strike-window-points` defaults to 100 index points around spot, and `--max-strikes` keeps the nearest strikes before resolving calls and puts.

With the API running, publish discovered contracts into local ingestion:

    pnpm collector:ibkr-contracts -- --port 4002 --expiry 2026-04-24 --publish

If no contracts are discovered, the command still publishes zero events and prints `contracts_count: 0`. This slice only discovers contracts; it does not subscribe to option ticks or stream live quotes.

### Local IBKR Delayed Snapshot

For local testing without real-time market-data subscriptions, request a one-shot delayed snapshot:

    pnpm collector:ibkr-delayed-snapshot -- --port 4002 --expiry 2026-04-27 --spot 7164.29 --strike-window-points 20 --max-strikes 9

This command uses IBKR market-data type `auto`: delayed streaming (`reqMarketDataType(3)`) during regular market hours and delayed frozen (`reqMarketDataType(4)`) outside regular market hours or on weekends. It discovers the requested SPX/SPXW contracts, snapshots delayed option quotes and Greeks, and emits a collector health event, an underlying tick, contract discovery events, and option tick events.

With the API running, publish the delayed snapshot into local ingestion:

    pnpm collector:ibkr-delayed-snapshot -- --port 4002 --expiry 2026-04-27 --spot 7164.29 --strike-window-points 20 --max-strikes 9 --publish

For a fuller option-chain view, widen the strike window and request more strikes:

    pnpm collector:ibkr-delayed-snapshot -- --port 4002 --expiry 2026-04-27 --spot 7164.29 --strike-window-points 125 --max-strikes 50 --publish

Use `--market-data-type 3` to force delayed streaming during market hours, or `--market-data-type 4` to force delayed frozen outside market hours. `--spot` can be used when SPX index top-of-book data is not subscribed or unavailable. The resulting dashboard data is still delayed and should be treated as a testing mode, not as real-time trading data.

After publishing, inspect captured replay sessions:

    curl -s http://127.0.0.1:8000/api/spx/0dte/replay/sessions | python -m json.tool

Use the captured `session_id` to replay the persisted IBKR snapshot:

    curl -s "http://127.0.0.1:8000/api/spx/0dte/replay/snapshot?session_id=<captured-session-id>" | python -m json.tool

Then open `http://localhost:3000`, use the replay controls, and pick the captured session. The seeded replay session remains available as a fallback demo.

### Local Moomoo 0DTE Snapshot

Moomoo is the default direction for new live-source work. The dashboard collector
uses local OpenD and keeps the current SPX dashboard contract by publishing only
SPX rows into the existing collector event path. The separate ML research
recorder below captures the wider configured universe to local JSONL files.

Install the Moomoo package in the project virtualenv:

    .venv/bin/python -m pip install --upgrade moomoo-api pandas

Start Moomoo OpenD locally and confirm it is listening on:

    host=127.0.0.1
    port=11111

Run one snapshot loop. SPX uses live `US.SPY` from Moomoo as its discovery baseline (`SPY * 10.035`), then replaces the published SPX spot with an option-implied value from live SPX call/put pairs when snapshots are available. Manual spot is still available for index symbols without a live proxy:

    pnpm collector:moomoo-snapshot -- --spot RUT=2050 --spot NDX=18300 --max-loops 1

Publish SPX compatibility events into the local FastAPI ingestion path. By default, the collector runs continuously and publishes each 2-second snapshot loop into the stable `moomoo-spx-0dte-live` dashboard session; pass `--max-loops 1` only for a bounded smoke test:

    pnpm dev:api
    pnpm collector:moomoo-snapshot -- --spot RUT=2050 --spot NDX=18300 --publish

The collector fetches the configured universe: SPX, SPY, QQQ, IWM, RUT, and NDX. It polls `get_market_snapshot()` every 2 seconds during active market/pre-open windows, reduces to once per minute from 5:00 PM to 8:30 AM New York time, refreshes the SPX spot proxy every loop, infers the SPX spot from same-strike call/put mids, and chunks requests to at most 400 option codes. The default expiry is chosen in New York time: today's 0DTE until 4:05 PM, then the next weekday session so expired 0DTE chains are not reused overnight. Pass `--expiry YYYY-MM-DD` only when you intentionally want to pin a smoke test to a specific expiry. It uses `get_option_chain()` at startup and again if the automatic expiry changes while the collector is running.

### Local Moomoo ML Research Recorder

Use the research recorder when the goal is future model training rather than
dashboard display. It preserves the complete Moomoo snapshot row in `raw` and
adds stable labels for later timeline alignment.

One-loop smoke capture:

    pnpm collector:moomoo-research-record -- --max-loops 1

Continuous 10-second capture:

    pnpm collector:moomoo-research-record

Market-hours capture that waits for 9:30 AM Eastern, exits after 4:00 PM
Eastern, and repeats weekdays while the process stays alive:

    pnpm collector:moomoo-research-market

All six configured tickers can run without manual spot input. SPX uses `US.SPY`
as its proxy; RUT uses `US.IWM * 10.0`; NDX uses `US.QQQ * 40.0`. Manual spots
remain available as overrides for unusual sessions:

    pnpm collector:moomoo-research-record -- --spot RUT=2150 --spot NDX=18400

The default output root is:

    /Users/sakura/local-ml-data/gamma-ml-research

The recorder writes four Moomoo families:

    moomoo/options/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    moomoo/underlyings/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    moomoo/batches/date=YYYY-MM-DD/ticker=SPX/records.jsonl
    moomoo/captures/date=YYYY-MM-DD/captures.jsonl

`options` is one row per option contract per capture. `batches` is one row per
ticker per capture, with all returned option contracts nested under
`contracts[]`. Use `raw` or `contracts[].raw` as the source of truth for future
feature engineering.

### Automatic Market-Hours Recording

Automatic Moomoo ML collection is configured through a macOS LaunchAgent:

    /Users/sakura/Library/LaunchAgents/com.sakura.gammascope.moomoo-research-recorder.plist

Moomoo OpenD is also managed by a LaunchAgent:

    /Users/sakura/Library/LaunchAgents/com.sakura.moomoo-opend.plist

It runs:

    /Users/sakura/WebstormProjects/gamma-scope/ops/run_moomoo_research_market.sh

The OpenD agent runs:

    /Users/sakura/WebstormProjects/gamma-scope/ops/run_moomoo_opend.sh

The OpenD wrapper checks every 60 seconds and opens
`/Applications/moomoo_OpenD.app` if it is not running. The recorder wrapper
starts the market-hours recorder, waits for the regular U.S. session when
needed, repeats across weekdays, and restarts after 5 minutes if the recorder
exits. Logs are written to:

    /Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-research-recorder.out.log
    /Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-research-recorder.err.log
    /Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-opend.out.log
    /Users/sakura/local-ml-data/gamma-ml-research/logs/moomoo-opend.err.log

Check service status:

    launchctl print gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
    launchctl print gui/$(id -u)/com.sakura.moomoo-opend

Restart after changing recorder arguments:

    launchctl kickstart -k gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
    launchctl kickstart -k gui/$(id -u)/com.sakura.moomoo-opend

Stop automatic collection:

    launchctl bootout gui/$(id -u)/com.sakura.gammascope.moomoo-research-recorder
    launchctl bootout gui/$(id -u)/com.sakura.moomoo-opend

Optional extra arguments live in:

    /Users/sakura/local-ml-data/gamma-ml-research/moomoo-recorder.args

Use that file for optional manual spot overrides or a 30-second fallback cadence. The
LaunchAgents cannot wake a sleeping Mac, and Moomoo OpenD still needs a valid
login session.

To wake the Mac automatically before market open, run the one-time root setup:

    sudo /Users/sakura/WebstormProjects/gamma-scope/ops/setup_market_wake_schedule.sh

That installs a weekday wake-or-power-on schedule at 6:20 AM local Mac time. In
Arizona that is before the 9:30 AM Eastern open during daylight-saving months
and still safely before open during standard-time months.

### SPX 0DTE Exposure Heatmap

The latest-ladder heatmap page is available at `http://localhost:3000/heatmap` when the web app is running.

The backend API is:

    GET /api/spx/0dte/heatmap/latest?metric=gex
    GET /api/spx/0dte/heatmap/latest?metric=vex

The first implementation uses signed OI proxy exposure: call open interest contributes positive exposure and put open interest contributes negative exposure. Moomoo open interest captured at or after 09:25 New York time is used as the daily baseline when available. Before that baseline is locked, heatmap payloads are marked provisional.

Heatmap snapshots are persisted to Postgres in full-resolution tables, with 5-minute bucket rows maintained for fast future history and replay work. The first page intentionally shows the latest ladder only; replay UI integration can build on the persisted heatmap history later.

### Local Replay Baseline Import

For a local-only replay baseline import, copy the parquet pair into the ignored `.gammascope/` directory and run the helper:

    mkdir -p .gammascope/replay-baselines/2026-04-22
    BASELINE_SOURCE_DIR="$HOME/Downloads/trade_date=2026-04-22 2"
    cp "$BASELINE_SOURCE_DIR/snapshots.parquet" .gammascope/replay-baselines/2026-04-22/snapshots.parquet
    cp "$BASELINE_SOURCE_DIR/quotes.parquet" .gammascope/replay-baselines/2026-04-22/quotes.parquet
    PYTHONPATH=apps/api .venv/bin/python -m gammascope_api.replay.baseline

To validate the local files without publishing them, run the optional smoke test:

    PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_replay_import_real_files.py -q

The `.gammascope/` directory is ignored by git and must stay local. Do not commit real replay baseline parquet files.

For local maintenance testing, run a default-safe dry run of persisted replay and saved-view retention cleanup:

    curl -s -X POST "http://127.0.0.1:8000/api/admin/retention/cleanup?dry_run=true" | python -m json.tool

To execute destructive cleanup explicitly:

    GAMMASCOPE_ADMIN_TOKEN=local-admin-token pnpm dev:api
    curl -s -X POST \
      -H "X-GammaScope-Admin-Token: local-admin-token" \
      "http://127.0.0.1:8000/api/admin/retention/cleanup?dry_run=false" | python -m json.tool

If `GAMMASCOPE_ADMIN_TOKEN` is unset or blank, destructive cleanup is disabled and returns `403`. Cleanup only targets Postgres-persisted replay snapshots/sessions and saved views. The seeded replay fixture remains untouched.

## Analytics Conventions

GammaScope uses a forward/discount-factor Black-Scholes-Merton convention for SPX-style European index options. Time to expiry is annualized with ACT/365, rates and dividend/carry inputs are continuously compounded annual decimals, and volatility is stored as annualized decimal volatility rather than percentage points.

Custom gamma is reported as delta change per one SPX index point. Custom vanna is calculated as raw delta change per 1.00 volatility unit, then display-normalized per one volatility point by multiplying by `0.01`. IBKR-provided IV and Greeks are stored as comparison fields only; missing or stale broker values should not block custom analytics.
