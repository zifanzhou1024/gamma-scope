# GammaScope Next Agent Handoff

This handoff is stored on `main` so a future agent can find the project state even if it does not start inside the hosted replay worktree.

## Current Branch State

- Main repo path: `/Users/sakura/WebstormProjects/gamma-scope`
- Hosted replay feature worktree: `/Users/sakura/WebstormProjects/gamma-scope/.worktrees/hosted-replay-demo`
- Hosted replay branch: `codex/hosted-replay-demo`
- Hosted replay commits at handoff time:
  - `e4f4e88 Add hosted replay demo deployment mode`
  - `d2bb609 Add next agent handoff notes`
- `codex/hosted-replay-demo` has not been pushed or merged to `main` yet.
- `main` was clean and synced with `origin/main` when this file was written.
- Existing stash on `main`: `stash@{0}: On main: pre-merge-main-test-contract-endpoints`. Do not drop it unless the user explicitly asks.

## What Is Implemented

- Monorepo foundation with Next.js web app, FastAPI API, shared contracts, Docker Compose Postgres/Redis, and seeded replay fixtures.
- Analytics core:
  - Documented Black-Scholes-Merton IV, gamma, and vanna conventions.
  - IBKR IV/Greeks stored as secondary comparison fields.
- Dashboard:
  - Replay dashboard, replay scrubber, scenario panel, saved views, operational notices, option chain, charts, and WebSocket/polling update paths.
- Collector path:
  - Mock collector publishing.
  - IBKR TCP health probe.
  - IBKR API handshake.
  - SPX/SPXW 0DTE contract discovery.
  - IBKR delayed snapshot publishing using market data type `3` when possible and `4` outside market hours.
- Persistence:
  - Postgres-backed replay capture for analytics snapshots.
  - Postgres-backed saved views.
  - Retention cleanup endpoint with local dry-run behavior and admin-gated hosted/private behavior.
- Redis:
  - Latest collector state cache with memory fallback.
- Hosted replay branch:
  - `GAMMASCOPE_HOSTED_REPLAY_MODE`.
  - Public replay REST and replay WebSocket remain open.
  - Live collector/state/latest/status/scenario live source/admin views/live WebSocket are gated by admin token in hosted mode.
  - `/healthz` process health endpoint.
  - API Dockerfile.
  - Vercel config.
  - Hosted replay env example.
  - README hosted replay instructions.

## How To Continue Hosted Replay Work

If the hosted replay worktree exists:

```bash
cd /Users/sakura/WebstormProjects/gamma-scope/.worktrees/hosted-replay-demo
git status --short --branch
```

If it does not exist, recreate it from the branch:

```bash
cd /Users/sakura/WebstormProjects/gamma-scope
git worktree add .worktrees/hosted-replay-demo codex/hosted-replay-demo
```

## How To Run Hosted Replay Locally

From `/Users/sakura/WebstormProjects/gamma-scope/.worktrees/hosted-replay-demo`:

```bash
docker build -f apps/api/Dockerfile -t gammascope-api:hosted-replay-verify .
docker run --rm --name gammascope-hosted-replay-local \
  -p 18080:8000 \
  -e GAMMASCOPE_HOSTED_REPLAY_MODE=true \
  -e GAMMASCOPE_ADMIN_TOKEN=local-hosted-demo-token \
  gammascope-api:hosted-replay-verify
```

In another terminal:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:18080 \
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:18080 \
pnpm --filter @gammascope/web exec next dev --port 3001 --hostname 127.0.0.1
```

Open:

```text
http://127.0.0.1:3001
```

Expected hosted replay behavior:

- Dashboard loads seeded replay data.
- `/healthz` reports `hosted_replay_mode: true`.
- Public replay endpoints work.
- Public live collector/admin surfaces return `403`.
- The dashboard may show `Fallback polling`; this is expected in public hosted replay mode because live WebSocket access is admin-gated.

## Verification Commands

Run these from the hosted replay worktree:

```bash
pnpm test:scripts
pnpm test:contracts
.venv/bin/pytest apps/api/tests -q
pnpm typecheck:web
pnpm test:web
pnpm test:collector
pnpm --filter @gammascope/web build
docker build -f apps/api/Dockerfile -t gammascope-api:hosted-replay-verify .
```

Container smoke checks:

```bash
curl -s http://127.0.0.1:18080/healthz | python -m json.tool
curl -s http://127.0.0.1:18080/api/spx/0dte/replay/sessions | python -m json.tool
curl -s "http://127.0.0.1:18080/api/spx/0dte/replay/snapshot?session_id=seed-spx-2026-04-23" | python -m json.tool
curl -i http://127.0.0.1:18080/api/spx/0dte/collector/state
curl -i -X POST "http://127.0.0.1:18080/api/admin/retention/cleanup?dry_run=true"
```

Expected public responses: replay endpoints `200`, collector state `403`, hosted admin dry-run `403`.

## What Is Left

1. Merge/push `codex/hosted-replay-demo`.
2. Deploy hosted replay:
   - Web on Vercel.
   - API on a hosted container service.
   - Managed Postgres and Redis.
   - Configure `GAMMASCOPE_API_BASE_URL` and `NEXT_PUBLIC_GAMMASCOPE_WS_URL` as hosted API origins.
3. Seed richer hosted replay sessions:
   - Current hosted demo can use seeded fixture data.
   - Stronger portfolio demo should import or capture real delayed IBKR sessions.
4. Finish real live IBKR collector:
   - Current local IBKR support includes handshake, discovery, and delayed snapshot.
   - Still needed: subscription-backed streaming option ticks and a robust reconnect/resubscribe loop.
5. Private hosted live bridge:
   - Local collector publishes securely to hosted API.
   - Needs authenticated collector identity, admin-only live dashboard access, disable switch, and stronger ops controls.
6. Product polish:
   - Watchlists are lightweight/not fully productized.
   - Alerts, export/share snapshot links, performance monitoring, and fuller auth/login UI are future work.

## Known Notes

- The current session may have a hosted replay API container on `127.0.0.1:18080` and a Next dev server on `127.0.0.1:3001` for browser testing. Check or stop those processes if the ports are needed.
- Next.js dev/build in the worktree may rewrite `apps/web/next-env.d.ts`; restore it before committing if it appears in `git status`.
- A Next.js warning about multiple lockfiles is expected in the worktree because both the parent repo and worktree have lockfiles.
- Do not expose IBKR live connectivity from hosted replay. The local IBKR collector remains local-only until the private live bridge is deliberately built.
