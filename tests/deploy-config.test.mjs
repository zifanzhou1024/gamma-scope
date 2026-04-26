import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("hosted replay API Dockerfile runs uvicorn from the API app", async () => {
  const dockerfile = await readFile(new URL("apps/api/Dockerfile", root), "utf8");

  assert.match(dockerfile, /FROM python:3\.13-slim/);
  assert.match(dockerfile, /PYTHONPATH=\/app\/apps\/api/);
  assert.match(dockerfile, /COPY packages\/contracts\/fixtures \.\/packages\/contracts\/fixtures/);
  assert.match(dockerfile, /pip install --no-cache-dir \.\/apps\/api/);
  assert.match(dockerfile, /uvicorn/);
  assert.match(dockerfile, /gammascope_api\.main:app/);
  assert.match(dockerfile, /--host/);
  assert.match(dockerfile, /0\.0\.0\.0/);
  assert.match(dockerfile, /--port/);
  assert.match(dockerfile, /\$\{PORT:-8000\}/);
});

test("vercel config targets the Next.js web app in the monorepo", async () => {
  const vercelConfig = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));

  assert.equal(vercelConfig.framework, "nextjs");
  assert.equal(vercelConfig.installCommand, "pnpm install --frozen-lockfile");
  assert.equal(vercelConfig.buildCommand, "pnpm --filter @gammascope/web build");
  assert.equal(vercelConfig.outputDirectory, "apps/web/.next");
});

test("hosted replay env example documents API and web deployment variables", async () => {
  const envExample = await readFile(new URL("deploy/hosted-replay.env.example", root), "utf8");

  for (const name of [
    "GAMMASCOPE_HOSTED_REPLAY_MODE=true",
    "GAMMASCOPE_PRIVATE_MODE_ENABLED=true",
    "GAMMASCOPE_ADMIN_TOKEN=",
    "GAMMASCOPE_DATABASE_URL=",
    "GAMMASCOPE_REDIS_URL=",
    "GAMMASCOPE_REPLAY_CAPTURE_INTERVAL_SECONDS=",
    "GAMMASCOPE_API_BASE_URL=",
    "NEXT_PUBLIC_GAMMASCOPE_WS_URL=",
  ]) {
    assert.match(envExample, new RegExp(`^${name}`, "m"));
  }

  assert.match(envExample, /^NEXT_PUBLIC_GAMMASCOPE_WS_URL=wss:\/\/gammascope-api\.example\.com$/m);
});
