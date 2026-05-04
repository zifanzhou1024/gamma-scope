import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploymentDoc = readFileSync(new URL("../docs/deployment.md", import.meta.url), "utf8");
const bootstrapScript = readFileSync(
  new URL("../ops/amh-nginx/bootstrap_gamma_server.sh", import.meta.url),
  "utf8",
);
const collectorScript = readFileSync(
  new URL("../ops/amh-nginx/start_moomoo_collector_mac.sh", import.meta.url),
  "utf8",
);

test("deployment guide documents the working AMH production target", () => {
  assert.match(deploymentDoc, /gamma\.hiqjj\.org/);
  assert.match(deploymentDoc, /149\.56\.14\.95/);
  assert.match(deploymentDoc, /Deployment branch:\s+main/);
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

test("deployment guide starts with a no-secret quick-start path", () => {
  assert.ok(
    deploymentDoc.indexOf("## Quick Start") < deploymentDoc.indexOf("## Current Production Shape"),
    "quick start should appear before the detailed runbook",
  );
  assert.match(deploymentDoc, /bootstrap_gamma_server\.sh/);
  assert.match(deploymentDoc, /raw\.githubusercontent\.com\/zifanzhou1024\/gamma-scope\/main\/ops\/amh-nginx\/bootstrap_gamma_server\.sh/);
  assert.match(deploymentDoc, /start_moomoo_collector_mac\.sh/);
  assert.doesNotMatch(deploymentDoc, /raw\.githubusercontent\.com\/zifanzhou1024\/gamma-scope\/codex\/amh-nginx-server-setup/);
  assert.match(bootstrapScript, /generate_secrets\.py/);
  assert.match(bootstrapScript, /BRANCH="\$\{GAMMASCOPE_BRANCH:-main\}"/);
  assert.match(bootstrapScript, /docker compose/);
  assert.match(bootstrapScript, /keeping existing secrets/);
  assert.match(collectorScript, /screen -dmS "\$SESSION_NAME"/);
  assert.match(collectorScript, /GAMMASCOPE_ADMIN_TOKEN/);
});

test("deployment quick start does not include concrete credentials", () => {
  const combined = `${deploymentDoc}\n${bootstrapScript}\n${collectorScript}`;
  const credentialPatterns = [
    /web admin password:\s+[A-Za-z0-9+/=_-]{12,}/i,
    /collector admin token:\s+[A-Za-z0-9+/=_-]{12,}/i,
    /root@149\.56\.14\.95's password:\s*\S+/i,
    /password of\s+\S+/i,
    /GAMMASCOPE_(?:ADMIN_TOKEN|WEB_ADMIN_PASSWORD|POSTGRES_PASSWORD|WEB_ADMIN_SESSION_SECRET)=[A-Za-z0-9+/=_-]{16,}/,
  ];

  for (const pattern of credentialPatterns) {
    assert.doesNotMatch(combined, pattern);
  }
});
