import { afterEach, describe, expect, it, vi } from "vitest";
import seedExperimentalFlow from "../../../packages/contracts/fixtures/experimental-flow.seed.json";

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

describe("GET /api/spx/0dte/experimental-flow/latest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("proxies latest experimental flow and preserves upstream body, status, and content type", async () => {
    const fetcher = vi.fn(async () => textResponse(JSON.stringify({ ok: true }), {
      status: 202,
      headers: {
        "Content-Type": "application/vnd.gammascope.experimental-flow+json"
      }
    }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest"));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe(JSON.stringify({ ok: true }));
    expect(response.headers.get("Content-Type")).toBe("application/vnd.gammascope.experimental-flow+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental-flow/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("uses the default FastAPI base URL for latest experimental flow", async () => {
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest"));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/experimental-flow/latest", {
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

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest", {
      headers: {
        Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`
      }
    }));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/experimental-flow/latest", {
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

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest"));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/experimental-flow/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns the seed experimental flow fallback when the latest upstream fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(seedExperimentalFlow);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the seed experimental flow fallback when the latest upstream responds non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(JSON.stringify({ error: "missing" }), { status: 404 })));

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/latest/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/experimental-flow/latest"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(seedExperimentalFlow);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/spx/0dte/experimental-flow/replay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("forwards allowed replay query parameters in order and preserves upstream text response", async () => {
    const fetcher = vi.fn(async () => textResponse("accepted", {
      status: 202,
      headers: {
        "Content-Type": "text/plain"
      }
    }));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/replay/route");
    const response = await GET(new Request(
      "http://localhost/api/spx/0dte/experimental-flow/replay?session_id=session%2Fa&horizon_minutes=30&at=2026-04-23T15:40:00Z&ignored=1"
    ));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("accepted");
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/experimental-flow/replay?session_id=session%2Fa&horizon_minutes=30&at=2026-04-23T15%3A40%3A00Z",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("omits absent optional replay query parameters and ignores unrelated parameters", async () => {
    const fetcher = vi.fn(async () => textResponse("{}"));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/replay/route");
    await GET(new Request(
      "http://localhost/api/spx/0dte/experimental-flow/replay?session_id=session-a&horizon_minutes=15&ignored=1"
    ));

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/experimental-flow/replay?session_id=session-a&horizon_minutes=15",
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

    const { GET } = await import("../app/api/spx/0dte/experimental-flow/replay/route");
    const response = await GET(new Request(
      "http://localhost/api/spx/0dte/experimental-flow/replay?session_id=session-a&horizon_minutes=15"
    ));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Experimental flow replay unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
