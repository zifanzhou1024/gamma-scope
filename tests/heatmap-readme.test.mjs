import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README documents the SPX heatmap API and page", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /SPX 0DTE Exposure Heatmap/);
  assert.match(readme, /\/api\/spx\/0dte\/heatmap\/latest/);
  assert.match(readme, /09:25/);
});
