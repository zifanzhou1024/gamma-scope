import { afterEach, describe, expect, it, vi } from "vitest";

const ADMIN_ENV = {
  NODE_ENV: "test",
  GAMMASCOPE_WEB_ADMIN_USERNAME: "admin",
  GAMMASCOPE_WEB_ADMIN_PASSWORD: "correct-horse-battery-staple",
  GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy"
} as const;

function adminEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    ...ADMIN_ENV,
    ...overrides
  } as NodeJS.ProcessEnv;
}

function setAdminEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_USERNAME);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_PASSWORD);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);

  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

function extractCookieValue(setCookie: string, name: string): string {
  const cookie = setCookie
    .split(", ")
    .find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return decodeURIComponent(cookie!.split(";")[0].slice(name.length + 1));
}

async function readJson(response: Response) {
  return response.json();
}

describe("admin session helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("makes admin unavailable when username, password, or session secret is missing", async () => {
    const { adminLoginAvailable, verifyAdminCredentials } = await import("../lib/adminSession");

    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_USERNAME: "" }))).toBe(false);
    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_PASSWORD: "" }))).toBe(false);
    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "" }))).toBe(false);
    expect(verifyAdminCredentials("admin", "correct-horse-battery-staple", adminEnv({
      GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: ""
    }))).toBe(false);
  });

  it("rejects missing or mismatched CSRF headers for unsafe requests", async () => {
    setAdminEnv();
    const { createAdminSessionValue, parseAdminSessionValue, verifyCsrf } = await import("../lib/adminSession");
    const session = parseAdminSessionValue(createAdminSessionValue());

    expect(session).not.toBeNull();
    expect(verifyCsrf(session, new Request("http://localhost/api/admin/logout", { method: "POST" }))).toBe(false);
    expect(verifyCsrf(session, new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { "X-GammaScope-CSRF": "wrong-token" }
    }))).toBe(false);
    expect(verifyCsrf(session, new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { "X-GammaScope-CSRF": session!.csrf_token }
    }))).toBe(true);
  });
});

describe("admin session routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("logs in with configured credentials, returns authenticated true, and sets the admin cookie", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME } = await import("../lib/adminSession");
    const { POST } = await import("../app/api/admin/login/route");

    const response = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ authenticated: true });
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });

  it("returns a generic 401 response for invalid credentials", async () => {
    setAdminEnv();
    const { POST } = await import("../app/api/admin/login/route");

    const response = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "not-the-password" })
    }));

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      authenticated: false,
      error: "Invalid credentials"
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 503 and no auth cookie when admin login is unavailable", async () => {
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", "");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", "correct-horse-battery-staple");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", "test-session-secret-with-enough-entropy");
    const { POST } = await import("../app/api/admin/login/route");

    const response = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toEqual({
      authenticated: false,
      error: "Admin login unavailable"
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns authenticated true and a CSRF token when the admin cookie is valid", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME, createAdminSessionValue } = await import("../lib/adminSession");
    const { GET } = await import("../app/api/admin/session/route");
    const sessionValue = createAdminSessionValue();

    const response = await GET(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}` }
    }));

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      authenticated: true,
      csrf_token: expect.any(String)
    });
    expect(payload.csrf_token.length).toBeGreaterThan(20);
  });

  it("returns authenticated false and a null CSRF token when the admin cookie is absent or invalid", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME } = await import("../lib/adminSession");
    const { GET } = await import("../app/api/admin/session/route");

    const absentResponse = await GET(new Request("http://localhost/api/admin/session"));
    expect(absentResponse.status).toBe(200);
    await expect(readJson(absentResponse)).resolves.toEqual({
      authenticated: false,
      csrf_token: null
    });

    const invalidResponse = await GET(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=invalid` }
    }));
    expect(invalidResponse.status).toBe(200);
    await expect(readJson(invalidResponse)).resolves.toEqual({
      authenticated: false,
      csrf_token: null
    });
  });

  it("clears the admin cookie on logout", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME } = await import("../lib/adminSession");
    const { POST } = await import("../app/api/admin/logout/route");

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ authenticated: false });
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
  });

  it("creates a route-readable signed session cookie from login", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME } = await import("../lib/adminSession");
    const loginRoute = await import("../app/api/admin/login/route");
    const sessionRoute = await import("../app/api/admin/session/route");

    const loginResponse = await loginRoute.POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));
    const cookieValue = extractCookieValue(loginResponse.headers.get("set-cookie")!, ADMIN_COOKIE_NAME);

    const sessionResponse = await sessionRoute.GET(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` }
    }));

    expect(sessionResponse.status).toBe(200);
    expect(await readJson(sessionResponse)).toEqual({
      authenticated: true,
      csrf_token: expect.any(String)
    });
  });
});
