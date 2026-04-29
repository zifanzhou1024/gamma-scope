import { describe, expect, it, vi } from "vitest";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import {
  isExperimentalAnalytics,
  loadClientExperimentalAnalytics,
  loadClientReplayExperimentalAnalytics,
  type ExperimentalReplayRequest
} from "../lib/clientExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("isExperimentalAnalytics", () => {
  it("accepts the seeded experimental analytics fixture", () => {
    expect(isExperimentalAnalytics(seedPayload)).toBe(true);
  });

  it("rejects malformed panel shapes", () => {
    expect(isExperimentalAnalytics({
      ...seedPayload,
      forwardSummary: {
        ...seedPayload.forwardSummary,
        diagnostics: "not-an-array"
      }
    })).toBe(false);

    expect(isExperimentalAnalytics({
      ...seedPayload,
      ivSmiles: {
        ...seedPayload.ivSmiles,
        methods: [{ ...seedPayload.ivSmiles.methods[0]!, points: "not-an-array" }]
      }
    })).toBe(false);

    expect(isExperimentalAnalytics({
      ...seedPayload,
      quoteQuality: {
        ...seedPayload.quoteQuality,
        score: Number.NaN
      }
    })).toBe(false);
  });

  it("rejects nonfinite source snapshot fields", () => {
    expect(isExperimentalAnalytics({
      ...seedPayload,
      sourceSnapshot: {
        ...seedPayload.sourceSnapshot,
        spot: Number.POSITIVE_INFINITY
      }
    })).toBe(false);
  });
});

describe("loadClientExperimentalAnalytics", () => {
  it("loads latest experimental analytics from the relative API route without caching", async () => {
    const fetcher = vi.fn(async () => jsonResponse(seedPayload));

    await expect(loadClientExperimentalAnalytics({ fetcher })).resolves.toBe(seedPayload);

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns null for fetch exceptions, non-OK responses, and invalid payloads", async () => {
    await expect(loadClientExperimentalAnalytics({
      fetcher: vi.fn(async () => {
        throw new Error("offline");
      })
    })).resolves.toBeNull();

    await expect(loadClientExperimentalAnalytics({
      fetcher: vi.fn(async () => jsonResponse({ error: "unavailable" }, false))
    })).resolves.toBeNull();

    await expect(loadClientExperimentalAnalytics({
      fetcher: vi.fn(async () => jsonResponse({ ...seedPayload, schema_version: "0.0.0" }))
    })).resolves.toBeNull();
  });
});

describe("loadClientReplayExperimentalAnalytics", () => {
  it("loads replay experimental analytics with session id and optional selectors", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      ...seedPayload,
      meta: {
        ...seedPayload.meta,
        mode: "replay"
      }
    }));
    const request: ExperimentalReplayRequest = {
      session_id: "session/a",
      at: "2026-04-23T15:40:00Z",
      source_snapshot_id: "snapshot-a"
    };

    await loadClientReplayExperimentalAnalytics(request, { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/experimental/replay/snapshot?session_id=session%2Fa&at=2026-04-23T15%3A40%3A00Z&source_snapshot_id=snapshot-a",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("omits absent replay query selectors", async () => {
    const fetcher = vi.fn(async () => jsonResponse(seedPayload));

    await loadClientReplayExperimentalAnalytics({ session_id: "session-a" }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/experimental/replay/snapshot?session_id=session-a", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns null for fetch exceptions, non-OK responses, and invalid payloads", async () => {
    await expect(loadClientReplayExperimentalAnalytics({ session_id: "session-a" }, {
      fetcher: vi.fn(async () => {
        throw new Error("offline");
      })
    })).resolves.toBeNull();

    await expect(loadClientReplayExperimentalAnalytics({ session_id: "session-a" }, {
      fetcher: vi.fn(async () => jsonResponse({ error: "unavailable" }, false))
    })).resolves.toBeNull();

    await expect(loadClientReplayExperimentalAnalytics({ session_id: "session-a" }, {
      fetcher: vi.fn(async () => jsonResponse({ ...seedPayload, sourceSnapshot: { ...seedPayload.sourceSnapshot, rowCount: -1 } }))
    })).resolves.toBeNull();
  });
});
