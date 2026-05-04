import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploymentDoc = readFileSync(new URL("../docs/deployment.md", import.meta.url), "utf8");

test("deployment guide documents the working AMH production target", () => {
  assert.match(deploymentDoc, /gamma\.hiqjj\.org/);
  assert.match(deploymentDoc, /149\.56\.14\.95/);
  assert.match(deploymentDoc, /codex\/amh-nginx-server-setup/);
  assert.match(deploymentDoc, /\/opt\/gammascope/);
  assert.match(deploymentDoc, /\/usr\/local\/nginx-1\.24\/sbin\/nginx/);
});

test("deployment guide preserves the public live viewing policy", () => {
  assert.match(deploymentDoc, /Public visitors can view the live dashboard/);
  assert.match(deploymentDoc, /web admin login is for replay import\/upload/);
  assert.match(deploymentDoc, /Collector ingestion, raw collector state, replay import mutation, and maintenance endpoints still require/);
});

test("deployment guide includes realtime collector operations and smoke tests", () => {
  assert.match(deploymentDoc, /screen -dmS gammascope-collector/);
  assert.match(deploymentDoc, /wss:\/\/gamma\.hiqjj\.org\/ws\/spx\/0dte/);
  assert.match(deploymentDoc, /moomoo-spx-0dte-live/);
  assert.match(deploymentDoc, /Do not add a broad `\/api\/ -> 127\.0\.0\.1:8000` rule/);
});
