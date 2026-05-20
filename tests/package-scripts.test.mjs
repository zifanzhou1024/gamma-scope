import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const dockerCompose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");

test("dev:api uses the project virtualenv python", () => {
  assert.match(packageJson.scripts["dev:api"], /\.venv\/bin\/python -m uvicorn /);
});

test("local dev scripts use uncommon localhost ports", () => {
  assert.equal(
    packageJson.scripts["dev:web"],
    "GAMMASCOPE_API_BASE_URL=http://127.0.0.1:42180 NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:42180/ws/spx/0dte pnpm --filter @gammascope/web exec next dev --hostname 127.0.0.1 --port 42130",
  );
  assert.equal(
    packageJson.scripts["dev:api"],
    "GAMMASCOPE_DATABASE_URL=postgresql://gammascope:gammascope@127.0.0.1:42432/gammascope GAMMASCOPE_REDIS_URL=redis://127.0.0.1:42379/0 .venv/bin/python -m uvicorn gammascope_api.main:app --reload --app-dir apps/api --host 127.0.0.1 --port 42180",
  );
});

test("local compose maps stateful services to uncommon host ports", () => {
  assert.match(dockerCompose, /"\$\{GAMMASCOPE_POSTGRES_HOST_PORT:-42432\}:5432"/);
  assert.match(dockerCompose, /"\$\{GAMMASCOPE_REDIS_HOST_PORT:-42379\}:6379"/);
});

test("root test script runs API tests with local Postgres", () => {
  assert.match(
    packageJson.scripts["test:api"],
    /^docker compose up -d postgres && GAMMASCOPE_DATABASE_URL=postgresql:\/\/gammascope:gammascope@127\.0\.0\.1:42432\/gammascope \.venv\/bin\/pytest apps\/api\/tests -q$/,
  );
  assert.match(packageJson.scripts.test, /pnpm test:api/);
});

test("collector:moomoo-snapshot runs the Moomoo collector from the project virtualenv", () => {
  assert.equal(
    packageJson.scripts["collector:moomoo-snapshot"],
    "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.moomoo_snapshot",
  );
});

test("collector:moomoo-research-record runs the local ML recorder from the project virtualenv", () => {
  assert.equal(
    packageJson.scripts["collector:moomoo-research-record"],
    "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.moomoo_research_recorder",
  );
});

test("collector:moomoo-research-market runs the repeat market-hours recorder", () => {
  assert.equal(
    packageJson.scripts["collector:moomoo-research-market"],
    "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.moomoo_research_recorder --market-hours --repeat-daily",
  );
});
