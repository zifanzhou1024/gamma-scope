import { afterEach, describe, expect, it, vi } from "vitest";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import { ADMIN_COOKIE_NAME, createAdminSessionValue } from "../lib/adminSession";
import { loadLatestExperimentalAnalytics } from "../lib/serverExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;

describe("loadLatestExperimentalAnalytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads latest experimental analytics directly from FastAPI on the server", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");
    const payload: ExperimentalAnalytics = {
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

    await expect(loadLatestExperimentalAnalytics(fetcher as typeof fetch, new Headers({
      "x-forwarded-host": "gamma.example",
      "x-forwarded-proto": "https"
    }))).resolves.toEqual(payload);

    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental/latest", {
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

    await loadLatestExperimentalAnalytics(fetcher as typeof fetch, new Headers({
      host: "gamma.local",
      cookie: sessionCookie
    }));

    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": "api-admin-token"
      }
    });
  });

  it("falls back to the seed payload for fetch failures, non-OK responses, and invalid payloads", async () => {
    await expect(loadLatestExperimentalAnalytics(vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch)).resolves.toEqual(seedPayload);

    await expect(loadLatestExperimentalAnalytics(vi.fn(async () => new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503
    })) as typeof fetch)).resolves.toEqual(seedPayload);

    await expect(loadLatestExperimentalAnalytics(vi.fn(async () => new Response(JSON.stringify({
      ...seedPayload,
      quoteQuality: {
        ...seedPayload.quoteQuality,
        flags: "not-an-array"
      }
    }), {
      status: 200
    })) as typeof fetch)).resolves.toEqual(seedPayload);
  });
});
