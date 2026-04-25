# GammaScope

## Local Development

GammaScope is being built in slices. The first slice establishes the local monorepo, shared contracts, seeded replay data, and smoke-testable API/web surfaces.

Run:

    pnpm install
    pnpm contracts:validate
    pnpm contracts:generate
    pnpm test
    docker compose up -d

### First Slice Verification

    pnpm install
    pnpm contracts:validate
    pnpm contracts:generate
    pnpm --filter @gammascope/contracts typecheck:generated
    pnpm typecheck:web
    pnpm test:web
    python3 -m venv .venv
    .venv/bin/python -m pip install -e "apps/api[dev]"
    .venv/bin/pytest apps/api/tests -q

Run local services:

    docker compose up -d
    pnpm dev:web
    .venv/bin/python -m uvicorn gammascope_api.main:app --reload --app-dir apps/api

Open the local dashboard at `http://localhost:3000`. The current dashboard is seeded replay data, shaped to match the live SPX 0DTE analytics contract.

### Mock Local Collector

Before connecting to IBKR, the collector slice can emit a deterministic SPX 0DTE event cycle as newline-delimited JSON:

    pnpm collector:mock -- --spot 5200.25 --expiry 2026-04-23 --strikes 5190,5200,5210

The mock output uses the same normalized collector event contract planned for the live IBKR adapter.

### Local Collector Ingestion

The API can accept one normalized collector event at a time during local testing:

    POST /api/spx/0dte/collector/events
    GET  /api/spx/0dte/collector/state

For now this stores the latest collector health, contracts, underlying ticks, and option ticks in process memory only. It is a local integration harness; Postgres/Redis persistence and snapshot assembly come in later slices.

With the API running, publish the mock collector cycle into that ingestion endpoint:

    pnpm dev:api
    pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210

Then inspect the live-mode analytics snapshot assembled from the ingested collector state:

    curl -s http://127.0.0.1:8000/api/spx/0dte/snapshot/latest | python -m json.tool

To test the dashboard against local API state, run the API, publish the mock cycle, then start the web app with the API base URL:

    pnpm dev:api
    pnpm collector:publish-mock -- --spot 5200.25 --expiry 2026-04-24 --strikes 5190,5200,5210
    GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 pnpm dev:web

Open `http://localhost:3000`. After the mock publish populates API state, the dashboard should show Live mode; if the API is unavailable, the web app falls back to the seeded replay snapshot. After page load, the dashboard polls the web snapshot route once per second so live mock snapshots refresh without a manual browser reload.

The dashboard also includes lightweight saved views for local testing. Saved views are validated against the shared contract, proxied through the Next.js app, and stored in the FastAPI process memory for now.

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

## Analytics Conventions

GammaScope uses a forward/discount-factor Black-Scholes-Merton convention for SPX-style European index options. Time to expiry is annualized with ACT/365, rates and dividend/carry inputs are continuously compounded annual decimals, and volatility is stored as annualized decimal volatility rather than percentage points.

Custom gamma is reported as delta change per one SPX index point. Custom vanna is calculated as raw delta change per 1.00 volatility unit, then display-normalized per one volatility point by multiplying by `0.01`. IBKR-provided IV and Greeks are stored as comparison fields only; missing or stale broker values should not block custom analytics.
