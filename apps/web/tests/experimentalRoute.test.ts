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

describe("GET /api/spx/0dte/experimental/latest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("proxies latest experimental analytics and preserves upstream body, status, and content type", async () => {
    const fetcher = vi.fn(async () => textResponse(JSON.stringify({ ok: true }), {
      status: 202,
      headers: {
        "Content-Type": "application/vnd.gammascope.experimental+json"
      }
    }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");

    const { GET } = await import("../app/api/spx/0dte/experimental/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/experimental/latest"));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe(JSON.stringify({ ok: true }));
    expect(response.headers.get("Content-Type")).toBe("application/vnd.gammascope.experimental+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("uses the default FastAPI base URL for latest experimental analytics", async () => {
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/experimental/latest"));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns no-store 502 JSON when the latest upstream fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/experimental/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/experimental/latest"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Experimental analytics unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/spx/0dte/experimental/replay/snapshot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("forwards replay experimental query parameters and preserves upstream text response", async () => {
    const fetcher = vi.fn(async () => textResponse("accepted", {
      status: 202,
      headers: {
        "Content-Type": "text/plain"
      }
    }));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental/replay/snapshot/route");
    const response = await GET(new Request(
      "http://localhost/api/spx/0dte/experimental/replay/snapshot?session_id=session%2Fa&at=2026-04-23T15:40:00Z&source_snapshot_id=snapshot-a&ignored=1"
    ));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("accepted");
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/experimental/replay/snapshot?session_id=session%2Fa&at=2026-04-23T15%3A40%3A00Z&source_snapshot_id=snapshot-a",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("omits absent replay experimental query parameters", async () => {
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental/replay/snapshot/route");
    await GET(new Request("http://localhost/api/spx/0dte/experimental/replay/snapshot?session_id=session-a"));

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/experimental/replay/snapshot?session_id=session-a",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("returns no-store 502 JSON when the replay upstream fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/experimental/replay/snapshot/route");
    const response = await GET(new Request(
      "http://localhost/api/spx/0dte/experimental/replay/snapshot?session_id=session-a"
    ));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Experimental replay analytics unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
