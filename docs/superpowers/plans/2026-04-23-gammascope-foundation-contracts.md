# GammaScope Foundation and Contracts Implementation Plan

> **For agentic workers:** REQUIRED: Use @superpowers:subagent-driven-development (if subagents available) or @superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-testable GammaScope foundation: monorepo tooling, shared contracts, generated frontend/backend types, seeded replay data, minimal API/web contract smoke, and local orchestration.

**Architecture:** JSON Schema files are the first source of truth for cross-service contracts. TypeScript types and Python Pydantic models are generated from those schemas, then used by a minimal FastAPI app and a minimal Next.js page that both read the same seeded `AnalyticsSnapshot`. This creates a stable harness for later analytics, replay UI, and IBKR collector work.

**Tech Stack:** pnpm workspaces, TypeScript, JSON Schema, AJV, `json-schema-to-typescript`, Python 3.11+, FastAPI, Pydantic, pytest, Next.js, React, Docker Compose for Postgres/Redis.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

This is Plan 1 only. It should produce working, testable software without implementing the full analytics engine or live IBKR collector.

In scope:

- Root monorepo structure and scripts.
- Shared contract schemas for collector events, snapshots, scenario requests, saved views, and health/status.
- Generated TypeScript and Python models from the shared schemas.
- Seeded SPX 0DTE replay fixture validated against the schemas.
- Minimal FastAPI endpoints returning seeded contract-shaped data.
- Minimal Next.js app that renders the seeded snapshot status and row count.
- Local developer orchestration for web, API, Postgres, and Redis.
- CI smoke tests for contracts, API, and web type checks.

Out of scope:

- Real Black-Scholes-Merton analytics implementation.
- IBKR connection or contract discovery.
- Production UI polish.
- Auth implementation.
- Hosted deployment.
- Scenario persistence.

## File Structure

- `.gitignore`: ignore generated/local artifacts, including `.superpowers/`, `.idea/`, `.env*`, Python caches, venvs, `node_modules`, `.next`, and coverage outputs.
- `package.json`: root pnpm workspace scripts for contracts, web, API smoke commands, and tests.
- `pnpm-workspace.yaml`: workspace membership for `apps/*` and `packages/*`.
- `docker-compose.yml`: local Postgres and Redis only.
- `docs/superpowers/plans/2026-04-23-gammascope-foundation-contracts.md`: this plan.
- `packages/contracts/package.json`: schema validation and TypeScript generation scripts.
- `packages/contracts/schemas/*.schema.json`: canonical JSON Schemas.
- `packages/contracts/fixtures/*.json`: seeded replay/status fixtures.
- `packages/contracts/src/generated/*.ts`: generated TypeScript types.
- `packages/contracts/tests/schema.test.mjs`: validates schemas and fixtures.
- `apps/api/pyproject.toml`: FastAPI package config and test dependencies.
- `apps/api/gammascope_api/main.py`: FastAPI app factory.
- `apps/api/gammascope_api/routes/*.py`: status, snapshot, replay, scenario, and views endpoints.
- `apps/api/gammascope_api/contracts/generated/*.py`: generated Pydantic models.
- `apps/api/gammascope_api/fixtures.py`: fixture loader.
- `apps/api/tests/*.py`: API contract tests.
- `apps/web/package.json`: Next.js app dependencies and scripts.
- `apps/web/app/page.tsx`: minimal local dashboard smoke page.
- `apps/web/lib/contracts.ts`: re-export generated contract types.
- `apps/web/lib/fixture.ts`: typed fixture import.
- `apps/web/tests/*.test.ts`: frontend fixture/type smoke tests.
- `.github/workflows/ci.yml`: contract/API/web CI smoke checks.

## Chunk 1: Local Foundation And Contracts

### Task 1: Create Root Workspace Foundation

**Files:**

- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `docker-compose.yml`
- Modify: `README.md`

- [ ] **Step 1: Check starting state**

Run:

```bash
git status --short
```

Expected: only pre-existing untracked local files such as `.idea/` and `.superpowers/`, unless the user has added new work.

- [ ] **Step 2: Create root ignore rules**

Create `.gitignore`:

```gitignore
# Local/editor
.idea/
.vscode/
.superpowers/
.DS_Store

# Environment
.env
.env.*
!.env.example

# Node
node_modules/
.next/
out/
coverage/
dist/
*.tsbuildinfo

# Python
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.mypy_cache/
.venv/
venv/

# Generated logs
*.log
```

- [ ] **Step 3: Create pnpm workspace config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create root `package.json`:

```json
{
  "name": "gamma-scope",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "contracts:validate": "pnpm --filter @gammascope/contracts validate",
    "contracts:generate": "pnpm --filter @gammascope/contracts generate",
    "test:contracts": "pnpm --filter @gammascope/contracts test",
    "test:web": "pnpm --filter @gammascope/web test",
    "typecheck:web": "pnpm --filter @gammascope/web typecheck",
    "dev:web": "pnpm --filter @gammascope/web dev",
    "dev:api": "python -m uvicorn gammascope_api.main:app --reload --app-dir apps/api",
    "test": "pnpm test:contracts && pnpm typecheck:web && pnpm test:web"
  }
}
```

- [ ] **Step 4: Add local service compose file**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: gammascope
      POSTGRES_USER: gammascope
      POSTGRES_PASSWORD: gammascope
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gammascope -d gammascope"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
```

- [ ] **Step 5: Update README local skeleton**

Modify `README.md` so it still starts with `# GammaScope`, then add:

## Local Development

GammaScope is being built in slices. The first slice establishes the local monorepo, shared contracts, seeded replay data, and smoke-testable API/web surfaces.

Run:

    pnpm install
    pnpm contracts:validate
    pnpm contracts:generate
    pnpm test
    docker compose up -d

- [ ] **Step 6: Verify root config**

Run:

```bash
pnpm --version
docker compose config
```

Expected: pnpm prints a version; Docker Compose validates the file without errors.

- [ ] **Step 7: Commit root foundation**

```bash
git add .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml docker-compose.yml README.md
git commit -m "chore: add workspace foundation"
```

### Task 2: Add Shared JSON Schemas And Fixture Validation

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/schemas/common.schema.json`
- Create: `packages/contracts/schemas/collector-events.schema.json`
- Create: `packages/contracts/schemas/analytics-snapshot.schema.json`
- Create: `packages/contracts/schemas/scenario.schema.json`
- Create: `packages/contracts/schemas/saved-view.schema.json`
- Create: `packages/contracts/fixtures/analytics-snapshot.seed.json`
- Create: `packages/contracts/fixtures/collector-health.seed.json`
- Create: `packages/contracts/fixtures/scenario-request.seed.json`
- Create: `packages/contracts/fixtures/saved-view.seed.json`
- Create: `packages/contracts/tests/schema.test.mjs`

- [ ] **Step 1: Create the failing schema test first**

Create `packages/contracts/tests/schema.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(import.meta.dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("all schemas compile", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  for (const schemaPath of [
    "schemas/common.schema.json",
    "schemas/collector-events.schema.json",
    "schemas/analytics-snapshot.schema.json",
    "schemas/scenario.schema.json",
    "schemas/saved-view.schema.json"
  ]) {
    const schema = await readJson(schemaPath);
    assert.doesNotThrow(() => ajv.compile(schema), schemaPath);
  }
});

test("seed analytics snapshot matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/analytics-snapshot.schema.json");
  const fixture = await readJson("fixtures/analytics-snapshot.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed collector health matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/collector-events.schema.json");
  const fixture = await readJson("fixtures/collector-health.seed.json");
  const validate = ajv.compile(schema.$defs.CollectorHealth);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed collector health matches collector event union", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/collector-events.schema.json");
  const fixture = await readJson("fixtures/collector-health.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed scenario request matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/scenario.schema.json");
  const fixture = await readJson("fixtures/scenario-request.seed.json");
  const validate = ajv.compile(schema.$defs.ScenarioRequest);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});

test("seed saved view matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/saved-view.schema.json");
  const fixture = await readJson("fixtures/saved-view.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});
```

- [ ] **Step 2: Add contract package metadata**

Create `packages/contracts/package.json`:

```json
{
  "name": "@gammascope/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "validate": "node --test tests/schema.test.mjs",
    "test": "node --test tests/schema.test.mjs",
    "generate": "mkdir -p src/generated && json2ts -i schemas/analytics-snapshot.schema.json -o src/generated/analytics-snapshot.ts && json2ts -i schemas/collector-events.schema.json -o src/generated/collector-events.ts && json2ts -i schemas/scenario.schema.json -o src/generated/scenario.ts && json2ts -i schemas/saved-view.schema.json -o src/generated/saved-view.ts"
  },
  "exports": {
    "./analytics-snapshot": "./src/generated/analytics-snapshot.ts",
    "./collector-events": "./src/generated/collector-events.ts",
    "./scenario": "./src/generated/scenario.ts",
    "./saved-view": "./src/generated/saved-view.ts"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "json-schema-to-typescript": "^15.0.4"
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm install
pnpm test:contracts
```

Expected: FAIL because schema and fixture files do not exist yet.

- [ ] **Step 4: Add common schema**

Create `packages/contracts/schemas/common.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/common.schema.json",
  "title": "GammaScope Common Contract Types",
  "type": "object",
  "$defs": {
    "IsoDateTime": {
      "type": "string",
      "format": "date-time"
    },
    "OptionRight": {
      "type": "string",
      "enum": ["call", "put"]
    },
    "QuoteStatus": {
      "type": "string",
      "enum": ["valid", "stale", "missing", "crossed", "invalid"]
    },
    "CalcStatus": {
      "type": "string",
      "enum": [
        "ok",
        "missing_quote",
        "invalid_quote",
        "below_intrinsic",
        "vol_out_of_bounds",
        "stale_underlying",
        "solver_failed",
        "out_of_model_scope"
      ]
    },
    "ComparisonStatus": {
      "type": "string",
      "enum": ["ok", "missing", "stale", "outside_tolerance", "not_supported"]
    }
  }
}
```

- [ ] **Step 5: Add collector event schema**

Create `packages/contracts/schemas/collector-events.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/collector-events.schema.json",
  "title": "CollectorEvents",
  "oneOf": [
    { "$ref": "#/$defs/CollectorHealth" },
    { "$ref": "#/$defs/ContractDiscovered" },
    { "$ref": "#/$defs/UnderlyingTick" },
    { "$ref": "#/$defs/OptionTick" }
  ],
  "$defs": {
    "CollectorHealth": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema_version",
        "source",
        "collector_id",
        "status",
        "ibkr_account_mode",
        "message",
        "event_time",
        "received_time"
      ],
      "properties": {
        "schema_version": { "type": "string", "const": "1.0.0" },
        "source": { "type": "string", "const": "ibkr" },
        "collector_id": { "type": "string", "minLength": 1 },
        "status": {
          "type": "string",
          "enum": ["starting", "connected", "degraded", "disconnected", "stale", "error"]
        },
        "ibkr_account_mode": { "type": "string", "enum": ["paper", "live", "unknown"] },
        "message": { "type": "string" },
        "event_time": { "type": "string", "format": "date-time" },
        "received_time": { "type": "string", "format": "date-time" }
      }
    },
    "ContractDiscovered": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema_version",
        "source",
        "session_id",
        "contract_id",
        "ibkr_con_id",
        "symbol",
        "expiry",
        "right",
        "strike",
        "multiplier",
        "exchange",
        "currency",
        "event_time"
      ],
      "properties": {
        "schema_version": { "type": "string", "const": "1.0.0" },
        "source": { "type": "string", "const": "ibkr" },
        "session_id": { "type": "string", "minLength": 1 },
        "contract_id": { "type": "string", "minLength": 1 },
        "ibkr_con_id": { "type": "integer" },
        "symbol": { "type": "string", "const": "SPX" },
        "expiry": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "right": { "type": "string", "enum": ["call", "put"] },
        "strike": { "type": "number", "exclusiveMinimum": 0 },
        "multiplier": { "type": "number", "exclusiveMinimum": 0 },
        "exchange": { "type": "string", "minLength": 1 },
        "currency": { "type": "string", "minLength": 1 },
        "event_time": { "type": "string", "format": "date-time" }
      }
    },
    "UnderlyingTick": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema_version",
        "source",
        "session_id",
        "symbol",
        "spot",
        "bid",
        "ask",
        "last",
        "mark",
        "event_time",
        "quote_status"
      ],
      "properties": {
        "schema_version": { "type": "string", "const": "1.0.0" },
        "source": { "type": "string", "const": "ibkr" },
        "session_id": { "type": "string", "minLength": 1 },
        "symbol": { "type": "string", "const": "SPX" },
        "spot": { "type": ["number", "null"] },
        "bid": { "type": ["number", "null"] },
        "ask": { "type": ["number", "null"] },
        "last": { "type": ["number", "null"] },
        "mark": { "type": ["number", "null"] },
        "event_time": { "type": "string", "format": "date-time" },
        "quote_status": { "type": "string", "enum": ["valid", "stale", "missing", "invalid"] }
      }
    },
    "OptionTick": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema_version",
        "source",
        "session_id",
        "contract_id",
        "bid",
        "ask",
        "last",
        "bid_size",
        "ask_size",
        "volume",
        "open_interest",
        "ibkr_iv",
        "ibkr_delta",
        "ibkr_gamma",
        "ibkr_vega",
        "ibkr_theta",
        "event_time",
        "quote_status"
      ],
      "properties": {
        "schema_version": { "type": "string", "const": "1.0.0" },
        "source": { "type": "string", "const": "ibkr" },
        "session_id": { "type": "string", "minLength": 1 },
        "contract_id": { "type": "string", "minLength": 1 },
        "bid": { "type": ["number", "null"] },
        "ask": { "type": ["number", "null"] },
        "last": { "type": ["number", "null"] },
        "bid_size": { "type": ["number", "null"] },
        "ask_size": { "type": ["number", "null"] },
        "volume": { "type": ["number", "null"] },
        "open_interest": { "type": ["number", "null"] },
        "ibkr_iv": { "type": ["number", "null"] },
        "ibkr_delta": { "type": ["number", "null"] },
        "ibkr_gamma": { "type": ["number", "null"] },
        "ibkr_vega": { "type": ["number", "null"] },
        "ibkr_theta": { "type": ["number", "null"] },
        "event_time": { "type": "string", "format": "date-time" },
        "quote_status": { "type": "string", "enum": ["valid", "stale", "missing", "crossed", "invalid"] }
      }
    }
  }
}
```

- [ ] **Step 6: Add analytics snapshot schema**

Create `packages/contracts/schemas/analytics-snapshot.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/analytics-snapshot.schema.json",
  "title": "AnalyticsSnapshot",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "session_id",
    "mode",
    "symbol",
    "expiry",
    "snapshot_time",
    "spot",
    "forward",
    "discount_factor",
    "risk_free_rate",
    "dividend_yield",
    "source_status",
    "freshness_ms",
    "coverage_status",
    "scenario_params",
    "rows"
  ],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0.0" },
    "session_id": { "type": "string", "minLength": 1 },
    "mode": { "type": "string", "enum": ["live", "replay", "scenario"] },
    "symbol": { "type": "string", "const": "SPX" },
    "expiry": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "snapshot_time": { "type": "string", "format": "date-time" },
    "spot": { "type": "number", "exclusiveMinimum": 0 },
    "forward": { "type": "number", "exclusiveMinimum": 0 },
    "discount_factor": { "type": "number", "exclusiveMinimum": 0, "maximum": 1.5 },
    "risk_free_rate": { "type": "number" },
    "dividend_yield": { "type": "number" },
    "source_status": {
      "type": "string",
      "enum": ["starting", "connected", "degraded", "disconnected", "stale", "error"]
    },
    "freshness_ms": { "type": "integer", "minimum": 0 },
    "coverage_status": { "type": "string", "enum": ["full", "partial", "empty"] },
    "scenario_params": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "spot_shift_points": { "type": "number" },
        "vol_shift_points": { "type": "number" },
        "time_shift_minutes": { "type": "number" }
      }
    },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "contract_id",
          "right",
          "strike",
          "bid",
          "ask",
          "mid",
          "custom_iv",
          "custom_gamma",
          "custom_vanna",
          "ibkr_iv",
          "ibkr_gamma",
          "ibkr_vanna",
          "iv_diff",
          "gamma_diff",
          "calc_status",
          "comparison_status"
        ],
        "properties": {
          "contract_id": { "type": "string", "minLength": 1 },
          "right": { "type": "string", "enum": ["call", "put"] },
          "strike": { "type": "number", "exclusiveMinimum": 0 },
          "bid": { "type": ["number", "null"] },
          "ask": { "type": ["number", "null"] },
          "mid": { "type": ["number", "null"] },
          "custom_iv": { "type": ["number", "null"], "minimum": 0 },
          "custom_gamma": { "type": ["number", "null"] },
          "custom_vanna": { "type": ["number", "null"] },
          "ibkr_iv": { "type": ["number", "null"] },
          "ibkr_gamma": { "type": ["number", "null"] },
          "ibkr_vanna": { "type": ["number", "null"] },
          "iv_diff": { "type": ["number", "null"] },
          "gamma_diff": { "type": ["number", "null"] },
          "calc_status": {
            "type": "string",
            "enum": [
              "ok",
              "missing_quote",
              "invalid_quote",
              "below_intrinsic",
              "vol_out_of_bounds",
              "stale_underlying",
              "solver_failed",
              "out_of_model_scope"
            ]
          },
          "comparison_status": {
            "type": "string",
            "enum": ["ok", "missing", "stale", "outside_tolerance", "not_supported"]
          }
        }
      }
    }
  }
}
```

- [ ] **Step 7: Add scenario and saved-view schemas**

Create `packages/contracts/schemas/scenario.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/scenario.schema.json",
  "title": "ScenarioContracts",
  "$defs": {
    "ScenarioRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": ["spot_shift_points", "vol_shift_points", "time_shift_minutes"],
      "oneOf": [
        { "type": "object", "required": ["base_snapshot_id"] },
        { "type": "object", "required": ["session_id", "snapshot_time"] }
      ],
      "properties": {
        "base_snapshot_id": { "type": "string", "minLength": 1 },
        "session_id": { "type": "string", "minLength": 1 },
        "snapshot_time": { "type": "string", "format": "date-time" },
        "spot_shift_points": { "type": "number" },
        "vol_shift_points": { "type": "number" },
        "time_shift_minutes": { "type": "number" }
      }
    }
  }
}
```

The first implementation returns the shared `AnalyticsSnapshot` contract directly from `/api/spx/0dte/scenario`; do not define a separate scenario response wrapper in this slice.

Create `packages/contracts/schemas/saved-view.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/saved-view.schema.json",
  "title": "SavedView",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "view_id",
    "owner_scope",
    "name",
    "mode",
    "strike_window",
    "visible_charts",
    "created_at"
  ],
  "properties": {
    "view_id": { "type": "string", "minLength": 1 },
    "owner_scope": { "type": "string", "enum": ["public_demo", "admin"] },
    "name": { "type": "string", "minLength": 1 },
    "mode": { "type": "string", "enum": ["live", "replay", "scenario"] },
    "strike_window": {
      "type": "object",
      "additionalProperties": false,
      "required": ["levels_each_side"],
      "properties": {
        "levels_each_side": { "type": "integer", "minimum": 1, "maximum": 50 }
      }
    },
    "visible_charts": {
      "type": "array",
      "items": { "type": "string", "enum": ["iv_smile", "gamma_by_strike", "vanna_by_strike"] },
      "minItems": 1,
      "uniqueItems": true
    },
    "created_at": { "type": "string", "format": "date-time" }
  }
}
```

- [ ] **Step 8: Add seeded fixtures**

Create `packages/contracts/fixtures/analytics-snapshot.seed.json` with one replay snapshot:

```json
{
  "schema_version": "1.0.0",
  "session_id": "seed-spx-2026-04-23",
  "mode": "replay",
  "symbol": "SPX",
  "expiry": "2026-04-23",
  "snapshot_time": "2026-04-23T16:00:00Z",
  "spot": 5200.25,
  "forward": 5200.31,
  "discount_factor": 0.99998,
  "risk_free_rate": 0.045,
  "dividend_yield": 0,
  "source_status": "connected",
  "freshness_ms": 500,
  "coverage_status": "partial",
  "scenario_params": null,
  "rows": [
    {
      "contract_id": "SPXW-2026-04-23-C-5200",
      "right": "call",
      "strike": 5200,
      "bid": 24.1,
      "ask": 24.7,
      "mid": 24.4,
      "custom_iv": 0.184,
      "custom_gamma": 0.0121,
      "custom_vanna": -0.0042,
      "ibkr_iv": 0.186,
      "ibkr_gamma": 0.0119,
      "ibkr_vanna": null,
      "iv_diff": -0.002,
      "gamma_diff": 0.0002,
      "calc_status": "ok",
      "comparison_status": "ok"
    },
    {
      "contract_id": "SPXW-2026-04-23-P-5200",
      "right": "put",
      "strike": 5200,
      "bid": 23.8,
      "ask": 24.5,
      "mid": 24.15,
      "custom_iv": 0.182,
      "custom_gamma": 0.0123,
      "custom_vanna": -0.004,
      "ibkr_iv": 0.181,
      "ibkr_gamma": 0.0124,
      "ibkr_vanna": null,
      "iv_diff": 0.001,
      "gamma_diff": -0.0001,
      "calc_status": "ok",
      "comparison_status": "ok"
    }
  ]
}
```

Create `packages/contracts/fixtures/collector-health.seed.json`:

```json
{
  "schema_version": "1.0.0",
  "source": "ibkr",
  "collector_id": "local-dev",
  "status": "connected",
  "ibkr_account_mode": "paper",
  "message": "Seed health fixture",
  "event_time": "2026-04-23T16:00:00Z",
  "received_time": "2026-04-23T16:00:01Z"
}
```

Create `packages/contracts/fixtures/scenario-request.seed.json`:

```json
{
  "session_id": "seed-spx-2026-04-23",
  "snapshot_time": "2026-04-23T16:00:00Z",
  "spot_shift_points": 25,
  "vol_shift_points": 1.5,
  "time_shift_minutes": -30
}
```

Create `packages/contracts/fixtures/saved-view.seed.json`:

```json
{
  "view_id": "seed-default-view",
  "owner_scope": "public_demo",
  "name": "Default replay view",
  "mode": "replay",
  "strike_window": {
    "levels_each_side": 20
  },
  "visible_charts": ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
  "created_at": "2026-04-23T16:00:00Z"
}
```

- [ ] **Step 9: Verify schema tests pass**

Run:

```bash
pnpm test:contracts
```

Expected: PASS.

- [ ] **Step 10: Commit schemas and fixtures**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat: add shared contract schemas"
```

## Chunk 2: Generated Contract Types

### Task 3: Generate TypeScript And Python Contract Types

**Files:**

- Modify: `packages/contracts/package.json`
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/gammascope_api/__init__.py`
- Create: `apps/api/gammascope_api/contracts/__init__.py`
- Create: `apps/api/gammascope_api/contracts/generated/__init__.py`
- Create: `apps/api/gammascope_api/contracts/generated/analytics_snapshot.py`
- Create: `apps/api/gammascope_api/contracts/generated/collector_events.py`
- Create: `apps/api/gammascope_api/contracts/generated/scenario.py`
- Create: `apps/api/gammascope_api/contracts/generated/saved_view.py`
- Create: `apps/api/tests/test_generated_contracts.py`
- Create: `packages/contracts/tsconfig.generated.json`
- Create: `packages/contracts/tests/generated-types.ts`

- [ ] **Step 1: Add API package metadata and package markers**

Create `apps/api/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "gammascope-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "pydantic>=2.8",
  "uvicorn[standard]>=0.30"
]

[project.optional-dependencies]
dev = [
  "datamodel-code-generator>=0.26",
  "httpx>=0.27",
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
  "ruff>=0.6"
]

[tool.setuptools.packages.find]
where = ["."]
include = ["gammascope_api*"]
```

Create package markers:

```bash
mkdir -p apps/api/gammascope_api/contracts
touch apps/api/gammascope_api/__init__.py apps/api/gammascope_api/contracts/__init__.py
```

- [ ] **Step 2: Add failing Python generated-contract test**

Create `apps/api/tests/test_generated_contracts.py`:

```python
import json
from pathlib import Path

from gammascope_api.contracts.generated.analytics_snapshot import AnalyticsSnapshot
from gammascope_api.contracts.generated.collector_events import CollectorHealth
from gammascope_api.contracts.generated.scenario import ScenarioRequest
from gammascope_api.contracts.generated.saved_view import SavedView


def test_seed_snapshot_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "analytics-snapshot.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    snapshot = AnalyticsSnapshot.model_validate(payload)

    assert snapshot.schema_version == "1.0.0"
    assert snapshot.symbol == "SPX"
    assert len(snapshot.rows) == 2


def test_seed_health_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "collector-health.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    health = CollectorHealth.model_validate(payload)

    assert health.source == "ibkr"
    assert health.status == "connected"


def test_seed_scenario_request_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "scenario-request.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    scenario_request = ScenarioRequest.model_validate(payload)

    assert scenario_request.session_id == "seed-spx-2026-04-23"
    assert scenario_request.vol_shift_points == 1.5


def test_seed_saved_view_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "saved-view.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    saved_view = SavedView.model_validate(payload)

    assert saved_view.owner_scope == "public_demo"
    assert saved_view.mode == "replay"
```

- [ ] **Step 3: Run test to verify it fails for the intended reason**

Run:

```bash
python -m pip install -e "apps/api[dev]"
pytest apps/api/tests/test_generated_contracts.py -q
```

Expected: FAIL with `ModuleNotFoundError` for `gammascope_api.contracts.generated` or `gammascope_api.contracts.generated.analytics_snapshot`.

- [ ] **Step 4: Generate Python and TypeScript types**

Run:

```bash
python -m pip install -e "apps/api[dev]"
mkdir -p apps/api/gammascope_api/contracts/generated
touch apps/api/gammascope_api/contracts/generated/__init__.py
pnpm contracts:generate
python -m datamodel_code_generator \
  --input packages/contracts/schemas/analytics-snapshot.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/analytics_snapshot.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/collector-events.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/collector_events.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/scenario.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/scenario.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/saved-view.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/saved_view.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
```

Expected:

- `packages/contracts/src/generated/analytics-snapshot.ts` exists.
- `packages/contracts/src/generated/collector-events.ts` exists.
- `packages/contracts/src/generated/scenario.ts` exists.
- `packages/contracts/src/generated/saved-view.ts` exists.
- `apps/api/gammascope_api/contracts/generated/analytics_snapshot.py` exists.
- `apps/api/gammascope_api/contracts/generated/collector_events.py` exists.
- `apps/api/gammascope_api/contracts/generated/scenario.py` exists.
- `apps/api/gammascope_api/contracts/generated/saved_view.py` exists.

- [ ] **Step 5: Add generated TypeScript import smoke**

Modify `packages/contracts/package.json` to add this script:

```json
"typecheck:generated": "tsc --project tsconfig.generated.json --noEmit"
```

Also add `typescript` to `packages/contracts/package.json` dev dependencies if it is not already present:

```json
"typescript": "^5.6.0"
```

Create `packages/contracts/tsconfig.generated.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/generated/**/*.ts", "tests/generated-types.ts"]
}
```

Create `packages/contracts/tests/generated-types.ts`:

```ts
import type { AnalyticsSnapshot } from "../src/generated/analytics-snapshot";
import type { CollectorEvents } from "../src/generated/collector-events";
import type { SavedView } from "../src/generated/saved-view";
import type { ScenarioRequest } from "../src/generated/scenario";

type _SnapshotSchemaVersion = AnalyticsSnapshot["schema_version"];
type _CollectorEvent = CollectorEvents;
type _ScenarioShift = ScenarioRequest["vol_shift_points"];
type _SavedViewMode = SavedView["mode"];
```

- [ ] **Step 6: Run generated contract tests**

Run:

```bash
pnpm install
pytest apps/api/tests/test_generated_contracts.py -q
pnpm --filter @gammascope/contracts typecheck:generated
git add packages/contracts/src apps/api/gammascope_api/contracts/generated
pnpm contracts:generate
python -m datamodel_code_generator \
  --input packages/contracts/schemas/analytics-snapshot.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/analytics_snapshot.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/collector-events.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/collector_events.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/scenario.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/scenario.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/saved-view.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/saved_view.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
git diff --exit-code -- packages/contracts/src apps/api/gammascope_api/contracts/generated
```

Expected: pytest PASS, TypeScript generated import smoke PASS, and `git diff --exit-code` exits 0, proving generation is repeatable after staging the generated outputs.

- [ ] **Step 7: Commit generated contract types**

```bash
git add packages/contracts/package.json packages/contracts/tsconfig.generated.json packages/contracts/tests/generated-types.ts packages/contracts/src pnpm-lock.yaml apps/api/pyproject.toml apps/api/gammascope_api apps/api/tests/test_generated_contracts.py
git commit -m "feat: generate contract types"
```

## Chunk 3: API, Web, And Local Verification

### Task 4: Add Minimal FastAPI Contract Smoke

**Files:**

- Create: `apps/api/gammascope_api/main.py`
- Create: `apps/api/gammascope_api/fixtures.py`
- Create: `apps/api/gammascope_api/routes/status.py`
- Create: `apps/api/gammascope_api/routes/snapshot.py`
- Create: `apps/api/gammascope_api/routes/replay.py`
- Create: `apps/api/gammascope_api/routes/scenario.py`
- Create: `apps/api/gammascope_api/routes/views.py`
- Create: `apps/api/gammascope_api/routes/__init__.py`
- Create: `apps/api/tests/test_contract_endpoints.py`

- [ ] **Step 1: Write failing API endpoint tests**

Create `apps/api/tests/test_contract_endpoints.py`:

```python
from fastapi.testclient import TestClient

from gammascope_api.main import app


client = TestClient(app)


def test_latest_snapshot_returns_seed_contract() -> None:
    response = client.get("/api/spx/0dte/snapshot/latest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.0.0"
    assert payload["mode"] == "replay"
    assert payload["symbol"] == "SPX"
    assert len(payload["rows"]) == 2


def test_status_returns_seed_health() -> None:
    response = client.get("/api/spx/0dte/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "ibkr"
    assert payload["status"] == "connected"


def test_replay_sessions_exposes_seed_session() -> None:
    response = client.get("/api/spx/0dte/replay/sessions")

    assert response.status_code == 200
    assert response.json()[0]["session_id"] == "seed-spx-2026-04-23"


def test_replay_snapshot_returns_seed_when_session_matches() -> None:
    response = client.get(
        "/api/spx/0dte/replay/snapshot",
        params={"session_id": "seed-spx-2026-04-23", "at": "2026-04-23T16:00:00Z"},
    )

    assert response.status_code == 200
    assert response.json()["session_id"] == "seed-spx-2026-04-23"


def test_scenario_returns_scenario_snapshot() -> None:
    response = client.post(
        "/api/spx/0dte/scenario",
        json={
            "session_id": "seed-spx-2026-04-23",
            "snapshot_time": "2026-04-23T16:00:00Z",
            "spot_shift_points": 25,
            "vol_shift_points": 1.5,
            "time_shift_minutes": -30,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "scenario"
    assert payload["scenario_params"]["vol_shift_points"] == 1.5


def test_saved_views_round_trip_in_memory() -> None:
    view = {
        "view_id": "seed-default-view",
        "owner_scope": "public_demo",
        "name": "Default replay view",
        "mode": "replay",
        "strike_window": {"levels_each_side": 20},
        "visible_charts": ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
        "created_at": "2026-04-23T16:00:00Z",
    }

    create_response = client.post("/api/views", json=view)
    list_response = client.get("/api/views")

    assert create_response.status_code == 200
    assert list_response.status_code == 200
    assert view in list_response.json()
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pytest apps/api/tests/test_contract_endpoints.py -q
```

Expected: FAIL because the app and routes are missing.

- [ ] **Step 3: Add fixture loader**

Create `apps/api/gammascope_api/fixtures.py`:

```python
import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages" / "contracts" / "fixtures"


@lru_cache
def load_json_fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text())
```

- [ ] **Step 4: Add routes and app**

Create `apps/api/gammascope_api/routes/__init__.py` as an empty package marker.

Create `apps/api/gammascope_api/routes/status.py`:

```python
from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/status")
def get_status() -> dict:
    return load_json_fixture("collector-health.seed.json")
```

Create `apps/api/gammascope_api/routes/snapshot.py`:

```python
from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/snapshot/latest")
def get_latest_snapshot() -> dict:
    return load_json_fixture("analytics-snapshot.seed.json")
```

Create `apps/api/gammascope_api/routes/replay.py`:

```python
from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.get("/api/spx/0dte/replay/sessions")
def list_replay_sessions() -> list[dict]:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    return [
        {
            "session_id": snapshot["session_id"],
            "symbol": snapshot["symbol"],
            "expiry": snapshot["expiry"],
            "start_time": snapshot["snapshot_time"],
            "end_time": snapshot["snapshot_time"],
            "snapshot_count": 1
        }
    ]


@router.get("/api/spx/0dte/replay/snapshot")
def get_replay_snapshot(session_id: str, at: str | None = None) -> dict:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")
    if session_id != snapshot["session_id"]:
        return {**snapshot, "coverage_status": "empty", "rows": []}
    return snapshot
```

Create `apps/api/gammascope_api/routes/scenario.py`:

```python
from copy import deepcopy
from typing import Any

from fastapi import APIRouter

from gammascope_api.fixtures import load_json_fixture


router = APIRouter()


@router.post("/api/spx/0dte/scenario")
def create_scenario(payload: dict[str, Any]) -> dict:
    snapshot = deepcopy(load_json_fixture("analytics-snapshot.seed.json"))
    snapshot["mode"] = "scenario"
    snapshot["scenario_params"] = {
        "spot_shift_points": payload.get("spot_shift_points", 0),
        "vol_shift_points": payload.get("vol_shift_points", 0),
        "time_shift_minutes": payload.get("time_shift_minutes", 0)
    }
    return snapshot
```

Create `apps/api/gammascope_api/routes/views.py`:

```python
from typing import Any

from fastapi import APIRouter


router = APIRouter()
_views: list[dict[str, Any]] = []


@router.get("/api/views")
def list_views() -> list[dict[str, Any]]:
    return _views


@router.post("/api/views")
def create_view(payload: dict[str, Any]) -> dict[str, Any]:
    _views.append(payload)
    return payload
```

Create `apps/api/gammascope_api/main.py`:

```python
from fastapi import FastAPI

from gammascope_api.routes import replay, scenario, snapshot, status, views


app = FastAPI(title="GammaScope API", version="0.1.0")

app.include_router(status.router)
app.include_router(snapshot.router)
app.include_router(replay.router)
app.include_router(scenario.router)
app.include_router(views.router)
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pytest apps/api/tests -q
```

Expected: PASS.

- [ ] **Step 6: Commit API smoke**

```bash
git add apps/api
git commit -m "feat: add fixture-backed API smoke"
```

### Task 5: Add Minimal Next.js Contract Smoke

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/lib/contracts.ts`
- Create: `apps/web/lib/seedSnapshot.ts`
- Create: `apps/web/tests/seedSnapshot.test.ts`

- [ ] **Step 1: Create failing frontend fixture test**

Create `apps/web/tests/seedSnapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../lib/seedSnapshot";

describe("seedSnapshot", () => {
  it("loads the shared AnalyticsSnapshot fixture", () => {
    expect(seedSnapshot.schema_version).toBe("1.0.0");
    expect(seedSnapshot.symbol).toBe("SPX");
    expect(seedSnapshot.rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Add web package metadata**

Create `apps/web/package.json`:

```json
{
  "name": "@gammascope/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@gammascope/contracts": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Run frontend test to verify it fails**

Run:

```bash
pnpm install
pnpm test:web
```

Expected: FAIL because web files are missing.

- [ ] **Step 4: Add minimal web app**

Create `apps/web/lib/contracts.ts`:

```ts
export type { AnalyticsSnapshot } from "@gammascope/contracts/analytics-snapshot";
```

Create `apps/web/lib/seedSnapshot.ts`:

```ts
import seed from "../../../packages/contracts/fixtures/analytics-snapshot.seed.json";
import type { AnalyticsSnapshot } from "./contracts";

export const seedSnapshot = seed as AnalyticsSnapshot;
```

Create `apps/web/app/page.tsx`:

```tsx
import { seedSnapshot } from "../lib/seedSnapshot";

export default function Home() {
  return (
    <main>
      <h1>GammaScope</h1>
      <p>Mode: {seedSnapshot.mode}</p>
      <p>Symbol: {seedSnapshot.symbol}</p>
      <p>Rows: {seedSnapshot.rows.length}</p>
    </main>
  );
}
```

Create `apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "GammaScope",
  description: "SPX 0DTE analytics dashboard"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {};

export default nextConfig;
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Run frontend checks**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: PASS.

- [ ] **Step 6: Commit web smoke**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add web contract smoke"
```

### Task 6: Add Local Verification And CI

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Add CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  contracts-and-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm contracts:validate
      - run: pnpm contracts:generate
      - run: pnpm --filter @gammascope/contracts typecheck:generated
      - run: git diff --exit-code -- packages/contracts/src
      - run: pnpm typecheck:web
      - run: pnpm test:web

  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python -m pip install -e "apps/api[dev]"
      - run: pytest apps/api/tests -q
```

- [ ] **Step 2: Update README commands**

Add:

### First Slice Verification

    pnpm contracts:validate
    pnpm contracts:generate
    pnpm --filter @gammascope/contracts typecheck:generated
    pnpm typecheck:web
    pnpm test:web
    python -m pip install -e "apps/api[dev]"
    pytest apps/api/tests -q

Run local services:

    docker compose up -d
    pnpm dev:web
    python -m uvicorn gammascope_api.main:app --reload --app-dir apps/api

- [ ] **Step 3: Run full local verification**

Run:

```bash
python -m pip install -e "apps/api[dev]"
pnpm contracts:validate
pnpm contracts:generate
python -m datamodel_code_generator \
  --input packages/contracts/schemas/analytics-snapshot.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/analytics_snapshot.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/collector-events.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/collector_events.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/scenario.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/scenario.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
python -m datamodel_code_generator \
  --input packages/contracts/schemas/saved-view.schema.json \
  --input-file-type jsonschema \
  --output apps/api/gammascope_api/contracts/generated/saved_view.py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp
pnpm --filter @gammascope/contracts typecheck:generated
git diff --exit-code -- packages/contracts/src apps/api/gammascope_api/contracts/generated
pnpm typecheck:web
pnpm test:web
pytest apps/api/tests -q
docker compose config
```

Expected: all commands pass and `git diff --exit-code` exits 0 after TypeScript and Python contract regeneration.

- [ ] **Step 4: Commit CI and docs**

```bash
git add .github/workflows/ci.yml README.md pnpm-lock.yaml
git commit -m "ci: add foundation smoke checks"
```

## Completion Criteria

- `pnpm contracts:validate` passes.
- `pnpm contracts:generate` is repeatable.
- `pytest apps/api/tests -q` passes.
- `pnpm typecheck:web` passes.
- `pnpm test:web` passes.
- `docker compose config` passes.
- API endpoints return the seeded SPX replay contracts.
- Web app renders the seeded snapshot in a minimal local page.
- All changes are committed in the task-level commits above.

## Follow-Up Plans

After this plan is complete, write separate plans for:

1. Analytics core: Black-Scholes-Merton formulas, IV solver, gamma/vanna fixtures, and documented numerical tests.
2. Replay dashboard: real chart/table UI using the seeded and stored snapshot contracts.
3. Local IBKR collector: mocked first, then real IBKR connection and SPX 0DTE discovery.
4. Live dashboard streaming: WebSocket fanout, freshness indicators, and snapshot cadence.
5. Scenario panel: backend scenario calculation and frontend controls.
6. Light private mode and hosted replay deployment.
