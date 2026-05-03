import { describe, expect, it, vi } from "vitest";
import seed from "../../../packages/contracts/fixtures/experimental-flow.seed.json";
import {
  isExperimentalFlow,
  loadClientExperimentalFlow,
  loadClientReplayExperimentalFlow,
  type ExperimentalFlowReplayRequest
} from "../lib/clientExperimentalFlowSource";
import type { ExperimentalFlow } from "../lib/contracts";

const seedPayload = seed as ExperimentalFlow;

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("isExperimentalFlow", () => {
  it("accepts the seeded experimental flow fixture", () => {
    expect(isExperimentalFlow(seedPayload)).toBe(true);
  });

  it("rejects invalid labels, nonfinite numbers, and out-of-range normalized scores", () => {
    expect(isExperimentalFlow({
      ...seedPayload,
      summary: {
        ...seedPayload.summary,
        confidence: "certain"
      }
    })).toBe(false);

    expect(isExperimentalFlow({
      ...seedPayload,
      contractRows: [{
        ...seedPayload.contractRows[0]!,
        aggressor: "customer_buy"
      }]
    })).toBe(false);

    expect(isExperimentalFlow({
      ...seedPayload,
      strikeRows: [{
        ...seedPayload.strikeRows[0]!,
        openingScore: 2
      }]
    })).toBe(false);

    expect(isExperimentalFlow({
      ...seedPayload,
      summary: {
        ...seedPayload.summary,
        netPremiumFlow: Number.NaN
      }
    })).toBe(false);
  });
});

describe("loadClientExperimentalFlow", () => {
  it("loads latest experimental flow from the relative API route without caching", async () => {
    const fetcher = vi.fn(async () => jsonResponse(seedPayload));

    await expect(loadClientExperimentalFlow({ fetcher })).resolves.toBe(seedPayload);

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/experimental-flow/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });
});

describe("loadClientReplayExperimentalFlow", () => {
  it("loads replay experimental flow with ordered query params", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      ...seedPayload,
      meta: {
        ...seedPayload.meta,
        mode: "replay"
      },
      replayValidation: {
        horizonMinutes: 15,
        hitRate: 0.5,
        rows: []
      }
    }));
    const request: ExperimentalFlowReplayRequest = {
      session_id: "session/a",
      at: "2026-04-24T15:30:00Z",
      horizon_minutes: 15
    };

    await loadClientReplayExperimentalFlow(request, { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/experimental-flow/replay?session_id=session%2Fa&horizon_minutes=15&at=2026-04-24T15%3A30%3A00Z",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("defaults omitted replay horizon to five minutes", async () => {
    const fetcher = vi.fn(async () => jsonResponse(seedPayload));

    await loadClientReplayExperimentalFlow({ session_id: "session/a" }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/experimental-flow/replay?session_id=session%2Fa&horizon_minutes=5",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });
});
