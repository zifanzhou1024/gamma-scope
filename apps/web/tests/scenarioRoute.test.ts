import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";

function scenarioSnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "route-scenario-session",
    mode: "scenario",
    scenario_params: {
      spot_shift_points: 20,
      vol_shift_points: 2,
      time_shift_minutes: -10
    }
  };
}

function scenarioRequest() {
  return {
    session_id: "route-live-session",
    snapshot_time: "2026-04-24T16:00:00Z",
    spot_shift_points: 20,
    vol_shift_points: 2,
    time_shift_minutes: -10
  };
}

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("POST /api/spx/0dte/scenario", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the scenario request to FastAPI and returns the scenario snapshot without caching", async () => {
    const snapshot = scenarioSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetcher);

    const { POST } = await import("../app/api/spx/0dte/scenario/route");
    const requestPayload = scenarioRequest();
    const response = await POST(new Request("http://localhost/api/spx/0dte/scenario", {
      method: "POST",
      body: JSON.stringify(requestPayload)
    }));

    await expect(response.json()).resolves.toEqual(JSON.parse(JSON.stringify(snapshot)));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/scenario", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(requestPayload)
    });
  });

  it("returns a no-store 502 response when the upstream response is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, false, 503)));

    const { POST } = await import("../app/api/spx/0dte/scenario/route");
    const response = await POST(new Request("http://localhost/api/spx/0dte/scenario", {
      method: "POST",
      body: JSON.stringify(scenarioRequest())
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Scenario request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...scenarioSnapshot(), symbol: "NDX" })));

    const { POST } = await import("../app/api/spx/0dte/scenario/route");
    const response = await POST(new Request("http://localhost/api/spx/0dte/scenario", {
      method: "POST",
      body: JSON.stringify(scenarioRequest())
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Scenario request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
