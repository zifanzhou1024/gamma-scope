import { describe, expect, it, vi } from "vitest";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import { loadLatestExperimentalAnalytics } from "../lib/serverExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;

describe("loadLatestExperimentalAnalytics", () => {
  it("loads latest experimental analytics from the same-origin proxy URL", async () => {
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

    expect(fetcher).toHaveBeenCalledWith("https://gamma.example/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("forwards the request cookie when present", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(seedPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));

    await loadLatestExperimentalAnalytics(fetcher as typeof fetch, new Headers({
      host: "gamma.local",
      cookie: "session=abc"
    }));

    expect(fetcher).toHaveBeenCalledWith("http://gamma.local/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: "session=abc"
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
