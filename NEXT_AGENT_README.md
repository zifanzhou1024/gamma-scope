# GammaScope Next Agent README

This file is a handoff note for the next coding agent. It summarizes what has been built, what remains, and how to verify the current state.

## Current Branch State

- Main repo path: `/Users/sakura/WebstormProjects/gamma-scope`
- Active feature worktree: `/Users/sakura/WebstormProjects/gamma-scope/.worktrees/hosted-replay-demo`
- Feature branch: `codex/hosted-replay-demo`
- Last committed hosted replay work before this handoff: `e4f4e88 Add hosted replay demo deployment mode`
- The branch has not been pushed or merged to `main` yet.
- `main` was clean and synced with `origin/main` when this handoff was written.
- The main repo has an older stash: `stash@{0}: On main: pre-merge-main-test-contract-endpoints`. Do not drop it unless the user explicitly asks.

## What Is Implemented

- Monorepo foundation with Next.js web app, FastAPI API, shared contracts, tests, Docker Compose Postgres/Redis, and seeded replay fixtures.
- Analytics core:
  - Black-Scholes-Merton IV, gamma, and vanna conventions are documented.
  - IBKR IV/Greeks are comparison fields, not the primary analytics source.
- Local dashboard:
  - Replay dashboard, replay scrubber, scenario panel, saved views, operational notices, option chain, charts, and WebSocket/polling update paths.
- Local collector path:
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
  - Latest collector state cache is implemented with memory fallback.
- Hosted replay demo branch:
  - `GAMMASCOPE_HOSTED_REPLAY_MODE`.
  - Public replay REST and replay WebSocket remain open.
  - Live collector/state/latest/status/scenario live source/admin views/live WS are gated by admin token in hosted mode.
  - `/healthz` process health endpoint.
  - API Dockerfile.
  - Vercel config.
  - Hosted replay env example.
  - README hosted replay instructions.

## How To Run The Current Hosted Replay Demo Locally

From `/Users/sakura/WebstormProjects/gamma-scope/.worktrees/hosted-replay-demo`:

```bash
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

Use the feature worktree:

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
   - Stronger portfolio demo should import/capture real delayed IBKR sessions.
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

- This session started a hosted replay API container on `127.0.0.1:18080` and a Next dev server on `127.0.0.1:3001` for browser testing. Check/stop those processes if you need the ports.
- Next.js dev/build in this worktree may rewrite `apps/web/next-env.d.ts`; restore it before committing if it appears in `git status`.
- A Next.js warning about multiple lockfiles is expected in the worktree because both the parent repo and worktree have lockfiles.
- Do not expose IBKR live connectivity from hosted replay. The local IBKR collector remains local-only until the private live bridge is deliberately built.
