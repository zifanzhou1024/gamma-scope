import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("dev:api uses the project virtualenv python", () => {
  assert.match(packageJson.scripts["dev:api"], /^\.venv\/bin\/python -m uvicorn /);
});

test("root test script runs API tests with local Postgres", () => {
  assert.match(packageJson.scripts["test:api"], /^docker compose up -d postgres && \.venv\/bin\/pytest apps\/api\/tests -q$/);
  assert.match(packageJson.scripts.test, /pnpm test:api/);
});

test("collector:moomoo-snapshot runs the Moomoo collector from the project virtualenv", () => {
  assert.equal(
    packageJson.scripts["collector:moomoo-snapshot"],
    "PYTHONPATH=services/collector:apps/api .venv/bin/python -m gammascope_collector.moomoo_snapshot",
  );
});
