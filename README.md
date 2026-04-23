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
