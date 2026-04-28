import { afterEach, describe, expect, it, vi } from "vitest";

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

describe("GET /api/spx/0dte/heatmap/latest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("proxies the metric query to FastAPI and preserves upstream body, status, and content type", async () => {
    const fetcher = vi.fn(async () => textResponse(JSON.stringify({ ok: true }), {
      status: 202,
      headers: {
        "Content-Type": "application/vnd.gammascope.heatmap+json"
      }
    }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");

    const { GET } = await import("../app/api/spx/0dte/heatmap/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/heatmap/latest?metric=vex"));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe(JSON.stringify({ ok: true }));
    expect(response.headers.get("Content-Type")).toBe("application/vnd.gammascope.heatmap+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=vex", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("uses the default FastAPI base URL", async () => {
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/heatmap/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/heatmap/latest?metric=gex"));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/heatmap/latest?metric=gex", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns no-store 502 JSON when the upstream fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/heatmap/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/heatmap/latest?metric=gex"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Heatmap API unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
