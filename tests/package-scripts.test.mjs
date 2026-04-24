import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("dev:api uses the project virtualenv python", () => {
  assert.match(packageJson.scripts["dev:api"], /^\.venv\/bin\/python -m uvicorn /);
});
