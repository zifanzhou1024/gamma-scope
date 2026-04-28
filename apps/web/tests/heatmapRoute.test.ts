import { afterEach, describe, expect, it, vi } from "vitest";

const ADMIN_ENV = {
  GAMMASCOPE_WEB_ADMIN_USERNAME: "admin",
  GAMMASCOPE_WEB_ADMIN_PASSWORD: "correct-horse-battery-staple",
  GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy",
  GAMMASCOPE_ADMIN_TOKEN: "upstream-admin-token"
} as const;

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

function setAdminEnv() {
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_USERNAME);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_PASSWORD);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
  vi.stubEnv("GAMMASCOPE_ADMIN_TOKEN", ADMIN_ENV.GAMMASCOPE_ADMIN_TOKEN);
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

  it("forwards the upstream admin token when the web admin session is valid", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME, createAdminSessionValue } = await import("../lib/adminSession");
    const sessionValue = createAdminSessionValue();
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/heatmap/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/heatmap/latest?metric=gex", {
      headers: {
        Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`
      }
    }));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/heatmap/latest?metric=gex", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": ADMIN_ENV.GAMMASCOPE_ADMIN_TOKEN
      }
    });
  });

  it("does not forward the upstream admin token when the request is unauthenticated", async () => {
    setAdminEnv();
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
