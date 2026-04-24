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

## Analytics Conventions

GammaScope uses a forward/discount-factor Black-Scholes-Merton convention for SPX-style European index options. Time to expiry is annualized with ACT/365, rates and dividend/carry inputs are continuously compounded annual decimals, and volatility is stored as annualized decimal volatility rather than percentage points.

Custom gamma is reported as delta change per one SPX index point. Custom vanna is calculated as raw delta change per 1.00 volatility unit, then display-normalized per one volatility point by multiplying by `0.01`. IBKR-provided IV and Greeks are stored as comparison fields only; missing or stale broker values should not block custom analytics.
