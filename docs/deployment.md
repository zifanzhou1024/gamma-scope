# GammaScope Deployment Guide

This guide covers the current deployable GammaScope stack for the live Moomoo-backed 0DTE heatmap and dashboard.

## Components

Run these services together:

- Postgres for replay snapshots, heatmap snapshots, 5-minute heatmap buckets, OI baselines, and saved views.
- FastAPI app from `apps/api`, exposed to the web app and collector.
- Next.js web app from `apps/web`.
- Moomoo OpenD on the machine that can access the licensed Moomoo data session.
- Moomoo snapshot collector from `services/collector`.

Redis is not required for this deployment. The heatmap history and replay path use Postgres.

## Required Environment

Set these for the API:

```bash
GAMMASCOPE_DATABASE_URL=postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope
GAMMASCOPE_REPLAY_CAPTURE_INTERVAL_SECONDS=5
GAMMASCOPE_REPLAY_RETENTION_DAYS=20
GAMMASCOPE_SAVED_VIEW_RETENTION_DAYS=90
```

Set private mode when the API is reachable outside a trusted local machine:

```bash
GAMMASCOPE_PRIVATE_MODE_ENABLED=true
GAMMASCOPE_ADMIN_TOKEN=<strong-admin-token>
```

Set these for the web app:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:8000/ws/spx/0dte
```

When private mode is enabled, also pass the same `GAMMASCOPE_ADMIN_TOKEN` to the web process so authenticated admin requests can proxy live data.

## Install

Install repo dependencies and the Python packages used by the API and collector:

```bash
pnpm install
python3 -m venv .venv
.venv/bin/python -m pip install -e "apps/api[dev]"
.venv/bin/python -m pip install --upgrade moomoo-api pandas
```

For local Postgres, start the compose service:

```bash
docker compose up -d postgres
```

For production, point `GAMMASCOPE_DATABASE_URL` at a persistent Postgres instance and keep the database on private networking when possible.

## Start Order

Start Postgres first, then API, then web, then Moomoo OpenD and the collector.

Run the API:

```bash
PYTHONPATH=apps/api \
GAMMASCOPE_DATABASE_URL=postgresql://gammascope:gammascope@127.0.0.1:5432/gammascope \
.venv/bin/python -m uvicorn gammascope_api.main:app \
  --app-dir apps/api \
  --host 0.0.0.0 \
  --port 8000
```

Run the web app in development mode:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:8000/ws/spx/0dte \
pnpm dev:web
```

For a long-running non-dev Next.js process, build and start Next directly:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:8000/ws/spx/0dte \
pnpm --filter @gammascope/web exec next build

GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:8000/ws/spx/0dte \
pnpm --filter @gammascope/web exec next start --hostname 0.0.0.0 --port 3000
```

Use a process manager such as `systemd`, `supervisord`, `pm2`, or `screen` to keep the API, web app, and collector alive.

## Moomoo Collector

Start Moomoo OpenD locally and confirm it listens on:

```text
host=127.0.0.1
port=11111
```

Run the Moomoo collector against the API:

```bash
pnpm collector:moomoo-snapshot -- \
  --api http://127.0.0.1:8000 \
  --spot RUT=2050 \
  --spot NDX=18300 \
  --publish
```

The collector currently discovers SPX, SPY, QQQ, IWM, RUT, and NDX. The heatmap API processes SPX, SPY, QQQ, IWM, and NDX. SPX is exposed as `SPXW` in heatmap payloads; the other symbols use their own trading class.

The API captures every ready Moomoo heatmap session from each bulk publish. This is important for multi-panel heatmap deployments: replay persistence should contain these live session IDs after successful collector publishes:

```text
moomoo-spx-0dte-live
moomoo-spy-0dte-live
moomoo-qqq-0dte-live
moomoo-iwm-0dte-live
moomoo-ndx-0dte-live
```

Open interest from Moomoo is treated as the daily OI baseline once captured at or after 09:25 New York time. Before that baseline locks, heatmap payloads remain marked provisional.

## Smoke Checks

Check API health:

```bash
curl -s http://127.0.0.1:8000/api/spx/0dte/status | python -m json.tool
```

Check every heatmap symbol:

```bash
for symbol in SPX SPY QQQ IWM NDX; do
  curl -fsS \
    "http://127.0.0.1:8000/api/spx/0dte/heatmap/latest?metric=gex&symbol=${symbol}" \
    | python -c 'import json,sys; p=json.load(sys.stdin); print(p["symbol"], p["sessionId"], len(p["rows"]), p["lastSyncedAt"])'
done
```

Expected result: every symbol prints its own symbol, a `moomoo-*-0dte-live` session ID, and a non-zero row count.

Confirm replay sessions are persisted:

```bash
psql "$GAMMASCOPE_DATABASE_URL" -c "
  select session_id, symbol, snapshot_count, end_time
  from replay_sessions
  where session_id like 'moomoo-%-0dte-live'
  order by session_id;
"
```

Open the web UI:

```text
http://localhost:3000/
http://localhost:3000/heatmap
```

## Operations

Keep the API and collector on the same trusted network. Collector ingestion can mutate live state and should be protected by private mode if exposed.

Do not commit `.gammascope/`, replay parquet files, database dumps, Moomoo credentials, API tokens, or raw licensed market data.

Run cleanup in dry-run mode first:

```bash
curl -s -X POST \
  "http://127.0.0.1:8000/api/admin/retention/cleanup?dry_run=true" \
  | python -m json.tool
```

When private mode is enabled, destructive cleanup requires the admin token:

```bash
curl -s -X POST \
  -H "X-GammaScope-Admin-Token: ${GAMMASCOPE_ADMIN_TOKEN}" \
  "http://127.0.0.1:8000/api/admin/retention/cleanup?dry_run=false" \
  | python -m json.tool
```

## Troubleshooting

If only SPX shows data, check that the collector is publishing all Moomoo compatibility events and that the API process has the multi-session replay capture code. The `/api/spx/0dte/collector/state` response should show multiple underlying ticks and option ticks after a successful collector publish.

If SPY, QQQ, IWM, or NDX returns `404`, query `replay_sessions` for the corresponding `moomoo-*-0dte-live` session and run a fresh collector publish. The heatmap route falls back to persisted Moomoo replay snapshots when in-memory collector state is empty.

If the web page shows unavailable panels but direct API requests work, confirm `GAMMASCOPE_API_BASE_URL` is set for the Next.js process and that the Next route proxy can reach the FastAPI host.

If the collector reports Moomoo snapshot request failures, confirm OpenD is running, logged in, and allowed to serve the subscribed quote data for the selected symbols.
