import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayImportResult } from "../lib/replayImportSource";

const ADMIN_ENV = {
  NODE_ENV: "test",
  GAMMASCOPE_WEB_ADMIN_USERNAME: "admin",
  GAMMASCOPE_WEB_ADMIN_PASSWORD: "correct-horse-battery-staple",
  GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy",
  GAMMASCOPE_ADMIN_TOKEN: "upstream-admin-token"
} as const;

function setAdminEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  vi.stubEnv("NODE_ENV", ADMIN_ENV.NODE_ENV);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_USERNAME);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_PASSWORD);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
  vi.stubEnv("GAMMASCOPE_ADMIN_TOKEN", ADMIN_ENV.GAMMASCOPE_ADMIN_TOKEN);
  vi.stubEnv("GAMMASCOPE_API_BASE_URL", "");

  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

async function adminHeaders(includeCsrf = true): Promise<HeadersInit> {
  const {
    ADMIN_COOKIE_NAME,
    CSRF_HEADER_NAME,
    createAdminSessionValue,
    parseAdminSessionValue
  } = await import("../lib/adminSession");
  const sessionValue = createAdminSessionValue();
  const session = parseAdminSessionValue(sessionValue);

  expect(session).not.toBeNull();

  return {
    Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
    ...(includeCsrf ? { [CSRF_HEADER_NAME]: session!.csrf_token } : {})
  };
}

function importResult(overrides: Partial<ReplayImportResult> = {}): ReplayImportResult {
  return {
    import_id: "import-test-1",
    status: "awaiting_confirmation",
    summary: { rows: 42 },
    warnings: ["missing iv for 1 row"],
    errors: [],
    session_id: null,
    replay_url: null,
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

describe("replay import proxy routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns 403 when upload is unauthenticated", async () => {
    setAdminEnv();
    const { POST } = await import("../app/api/replay/imports/route");
    const response = await POST(new Request("http://localhost/api/replay/imports", { method: "POST" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin session required" });
  });

  it("returns 503 when admin login is unavailable", async () => {
    setAdminEnv({ GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "" });
    const { GET } = await import("../app/api/replay/imports/[importId]/route");
    const response = await GET(new Request("http://localhost/api/replay/imports/import-test-1"), {
      params: Promise.resolve({ importId: "import-test-1" })
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Admin login unavailable" });
  });

  it("returns 503 when the upstream admin token is unavailable", async () => {
    setAdminEnv({ GAMMASCOPE_ADMIN_TOKEN: "" });
    const { GET } = await import("../app/api/replay/imports/[importId]/route");
    const response = await GET(new Request("http://localhost/api/replay/imports/import-test-1", {
      headers: await adminHeaders(false)
    }), {
      params: Promise.resolve({ importId: "import-test-1" })
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Replay import proxy unavailable" });
  });

  it.each([
    ["upload", async () => {
      const { POST } = await import("../app/api/replay/imports/route");
      return POST(new Request("http://localhost/api/replay/imports", {
        method: "POST",
        headers: await adminHeaders(false)
      }));
    }],
    ["confirm", async () => {
      const { POST } = await import("../app/api/replay/imports/[importId]/confirm/route");
      return POST(new Request("http://localhost/api/replay/imports/import-test-1/confirm", {
        method: "POST",
        headers: await adminHeaders(false)
      }), {
        params: Promise.resolve({ importId: "import-test-1" })
      });
    }],
    ["cancel", async () => {
      const { DELETE } = await import("../app/api/replay/imports/[importId]/route");
      return DELETE(new Request("http://localhost/api/replay/imports/import-test-1", {
        method: "DELETE",
        headers: await adminHeaders(false)
      }), {
        params: Promise.resolve({ importId: "import-test-1" })
      });
    }]
  ])("returns 403 when %s is missing CSRF", async (_, requestRoute) => {
    setAdminEnv();
    const response = await requestRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin session required" });
  });

  it("forwards multipart uploads to FastAPI with the upstream admin token", async () => {
    setAdminEnv({ GAMMASCOPE_API_BASE_URL: "http://fastapi.test/" });
    const upstream = importResult();
    const fetcher = vi.fn(async () => jsonResponse(upstream, true, 201));
    vi.stubGlobal("fetch", fetcher);
    const form = new FormData();
    form.append("file", new Blob(["csv"]), "replay.csv");
    const { POST } = await import("../app/api/replay/imports/route");

    const response = await POST(new Request("http://localhost/api/replay/imports", {
      method: "POST",
      headers: await adminHeaders(),
      body: form
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(upstream);
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/replay/imports", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": "upstream-admin-token"
      },
      body: expect.any(FormData)
    });
  });

  it("preserves upload replay import response fields", async () => {
    setAdminEnv();
    const upstream = importResult({
      status: "completed",
      summary: { rows: 42, trades: 7 },
      warnings: [],
      errors: [],
      session_id: "session-1",
      replay_url: "/replay?session_id=session-1"
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(upstream)));
    const { POST } = await import("../app/api/replay/imports/route");

    const response = await POST(new Request("http://localhost/api/replay/imports", {
      method: "POST",
      headers: await adminHeaders(),
      body: new FormData()
    }));

    await expect(response.json()).resolves.toEqual(upstream);
  });

  it("requires an admin session to load an import", async () => {
    setAdminEnv();
    const { GET } = await import("../app/api/replay/imports/[importId]/route");
    const response = await GET(new Request("http://localhost/api/replay/imports/import-test-1"), {
      params: Promise.resolve({ importId: "import-test-1" })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin session required" });
  });

  it("forwards import loads to FastAPI with the upstream admin token", async () => {
    setAdminEnv({ GAMMASCOPE_API_BASE_URL: "http://fastapi.test" });
    const fetcher = vi.fn(async () => jsonResponse(importResult()));
    vi.stubGlobal("fetch", fetcher);
    const { GET } = await import("../app/api/replay/imports/[importId]/route");

    const response = await GET(new Request("http://localhost/api/replay/imports/import-test%2F1", {
      headers: await adminHeaders(false)
    }), {
      params: Promise.resolve({ importId: "import-test/1" })
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/replay/imports/import-test%2F1", {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": "upstream-admin-token"
      }
    });
  });

  it.each([
    ["confirm", 202, "publishing", async () => {
      const { POST } = await import("../app/api/replay/imports/[importId]/confirm/route");
      return POST(new Request("http://localhost/api/replay/imports/import-test-1/confirm", {
        method: "POST",
        headers: await adminHeaders()
      }), {
        params: Promise.resolve({ importId: "import-test-1" })
      });
    }],
    ["cancel", 409, "failed", async () => {
      const { DELETE } = await import("../app/api/replay/imports/[importId]/route");
      return DELETE(new Request("http://localhost/api/replay/imports/import-test-1", {
        method: "DELETE",
        headers: await adminHeaders()
      }), {
        params: Promise.resolve({ importId: "import-test-1" })
      });
    }]
  ])("maps upstream %s status through", async (_, status, importStatus, requestRoute) => {
    setAdminEnv();
    const upstream = importResult({ status: importStatus as ReplayImportResult["status"] });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(upstream, status < 400, status)));

    const response = await requestRoute();

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(upstream);
  });

  it("returns 502 for invalid upstream responses", async () => {
    setAdminEnv();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...importResult(), status: "ready" })));
    const { GET } = await import("../app/api/replay/imports/[importId]/route");

    const response = await GET(new Request("http://localhost/api/replay/imports/import-test-1", {
      headers: await adminHeaders(false)
    }), {
      params: Promise.resolve({ importId: "import-test-1" })
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay import request failed" });
  });
});
