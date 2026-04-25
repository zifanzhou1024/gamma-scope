import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectorHealth } from "@gammascope/contracts/collector-events";

function collectorHealth(overrides: Partial<CollectorHealth> = {}): CollectorHealth {
  return {
    schema_version: "1.0.0",
    source: "ibkr",
    collector_id: "route-collector",
    status: "connected",
    ibkr_account_mode: "paper",
    message: "Route collector ready",
    event_time: "2026-04-24T15:00:00Z",
    received_time: "2026-04-24T15:00:01Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("GET /api/spx/0dte/status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards collector status to FastAPI and returns no-store JSON", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.local:9000/");
    const payload = collectorHealth();
    const fetcher = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual(payload);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.local:9000/api/spx/0dte/status", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a no-store 502 response when the upstream status payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...collectorHealth(), status: "warming" })));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream status payload has additional properties", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...collectorHealth(), extra: true })));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream status payload has an empty collector ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(collectorHealth({ collector_id: "" }))));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream status payload has invalid timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(collectorHealth({ event_time: "2026-02-31T00:00:00Z" }))));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream status request is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, false, 503)));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the upstream status request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/status/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Collector status request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
