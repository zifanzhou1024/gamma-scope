import { afterEach, describe, expect, it, vi } from "vitest";
import seed from "../../../packages/contracts/fixtures/experimental-flow.seed.json";
import { ADMIN_COOKIE_NAME, createAdminSessionValue } from "../lib/adminSession";
import { loadLatestExperimentalFlow } from "../lib/serverExperimentalFlowSource";
import type { ExperimentalFlow } from "../lib/contracts";

const seedPayload = seed as ExperimentalFlow;

describe("loadLatestExperimentalFlow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads latest experimental flow directly from FastAPI on the server", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");
    const payload: ExperimentalFlow = {
      ...seedPayload,
      meta: {
        ...seedPayload.meta,
        sourceSessionId: "api-session"
      }
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));

    await expect(loadLatestExperimentalFlow(fetcher as typeof fetch, new Headers({
      "x-forwarded-host": "gamma.example",
      "x-forwarded-proto": "https"
    }))).resolves.toEqual(payload);

    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental-flow/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("forwards the backend admin token for a valid server admin session", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test");
    vi.stubEnv("GAMMASCOPE_ADMIN_TOKEN", "api-admin-token");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", "admin");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", "password");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", "x".repeat(32));

    const fetcher = vi.fn(async () => new Response(JSON.stringify(seedPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
    const sessionCookie = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(createAdminSessionValue())}`;

    await loadLatestExperimentalFlow(fetcher as typeof fetch, new Headers({
      host: "gamma.local",
      cookie: sessionCookie
    }));

    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental-flow/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": "api-admin-token"
      }
    });
  });

  it("falls back to the seed payload for fetch failures, non-OK responses, and invalid payloads", async () => {
    await expect(loadLatestExperimentalFlow(vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch)).resolves.toEqual(seedPayload);

    await expect(loadLatestExperimentalFlow(vi.fn(async () => new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503
    })) as typeof fetch)).resolves.toEqual(seedPayload);

    await expect(loadLatestExperimentalFlow(vi.fn(async () => new Response(JSON.stringify({
      ...seedPayload,
      summary: {
        ...seedPayload.summary,
        confidence: "certain"
      }
    }), {
      status: 200
    })) as typeof fetch)).resolves.toEqual(seedPayload);
  });
});
