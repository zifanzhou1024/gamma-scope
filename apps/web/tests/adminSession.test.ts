import { afterEach, describe, expect, it, vi } from "vitest";

const ADMIN_ENV = {
  NODE_ENV: "test",
  GAMMASCOPE_WEB_ADMIN_USERNAME: "admin",
  GAMMASCOPE_WEB_ADMIN_PASSWORD: "correct-horse-battery-staple",
  GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy"
} as const;

const WEAK_SESSION_SECRET = "short-secret";

function adminEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    ...ADMIN_ENV,
    ...overrides
  } as NodeJS.ProcessEnv;
}

function setAdminEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  vi.stubEnv("NODE_ENV", ADMIN_ENV.NODE_ENV);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("RENDER", "");
  vi.stubEnv("FLY_APP_NAME", "");
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

function tamperSessionValue(value: string): string {
  const [payload, signature] = value.split(".");
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const tamperedPayload = Buffer.from(JSON.stringify({
    ...session,
    csrf_token: "tampered-token"
  }), "utf8").toString("base64url");

  return `${tamperedPayload}.${signature}`;
}

describe("admin session helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("makes admin unavailable when username, password, session secret is missing, or session secret is weak", async () => {
    const { adminLoginAvailable, verifyAdminCredentials } = await import("../lib/adminSession");

    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_USERNAME: "" }))).toBe(false);
    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_PASSWORD: "" }))).toBe(false);
    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "" }))).toBe(false);
    expect(adminLoginAvailable(adminEnv({ GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: `  ${WEAK_SESSION_SECRET}  ` }))).toBe(false);
    expect(verifyAdminCredentials("admin", "correct-horse-battery-staple", adminEnv({
      GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: WEAK_SESSION_SECRET
    }))).toBe(false);
  });

  it("throws when creating and returns null when parsing sessions with a weak secret", async () => {
    setAdminEnv();
    const { createAdminSessionValue, parseAdminSessionValue } = await import("../lib/adminSession");
    const sessionValue = createAdminSessionValue();

    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", WEAK_SESSION_SECRET);

    expect(() => createAdminSessionValue()).toThrow("Admin session secret is not configured");
    expect(parseAdminSessionValue(sessionValue)).toBeNull();
  });

  it("rejects wrong username and wrong password credentials", async () => {
    const { verifyAdminCredentials } = await import("../lib/adminSession");

    expect(verifyAdminCredentials("not-admin", "correct-horse-battery-staple", adminEnv())).toBe(false);
    expect(verifyAdminCredentials("admin", "not-the-password", adminEnv())).toBe(false);
    expect(verifyAdminCredentials("not-admin", "not-the-password", adminEnv())).toBe(false);
  });

  it("rejects tampered and expired signed session values", async () => {
    setAdminEnv();
    const { createAdminSessionValue, parseAdminSessionValue } = await import("../lib/adminSession");
    const now = Date.UTC(2026, 3, 26, 12, 0, 0);
    const sessionValue = createAdminSessionValue(now);

    expect(parseAdminSessionValue(tamperSessionValue(sessionValue), now)).toBeNull();
    expect(parseAdminSessionValue(sessionValue, now + 8 * 60 * 60 * 1000 + 1000)).toBeNull();
  });

  it("parses admin sessions from requests and verifies auth and CSRF for guard consumers", async () => {
    setAdminEnv();
    const {
      ADMIN_COOKIE_NAME,
      CSRF_HEADER_NAME,
      createAdminSessionValue,
      parseAdminSessionFromRequest,
      verifyAdminRequest
    } = await import("../lib/adminSession");
    const sessionValue = createAdminSessionValue();
    const session = parseAdminSessionFromRequest(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}` }
    }));

    expect(session).not.toBeNull();
    expect(verifyAdminRequest(new Request("http://localhost/api/admin/proxy", {
      method: "GET",
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}` }
    }))).toEqual({
      ok: true,
      reason: null,
      session
    });
    expect(verifyAdminRequest(new Request("http://localhost/api/admin/proxy", {
      method: "POST",
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}` }
    }), { csrf: true })).toMatchObject({
      ok: false,
      reason: "invalid_csrf",
      session
    });
    expect(verifyAdminRequest(new Request("http://localhost/api/admin/proxy", {
      method: "POST",
      headers: {
        Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
        [CSRF_HEADER_NAME]: session!.csrf_token
      }
    }), { csrf: true })).toEqual({
      ok: true,
      reason: null,
      session
    });
    expect(verifyAdminRequest(new Request("http://localhost/api/admin/proxy"))).toEqual({
      ok: false,
      reason: "unauthenticated",
      session: null
    });

    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", WEAK_SESSION_SECRET);
    expect(verifyAdminRequest(new Request("http://localhost/api/admin/proxy"))).toEqual({
      ok: false,
      reason: "unavailable",
      session: null
    });
  });

  it("tracks failed login attempts and resets lockout on success", async () => {
    const {
      adminLoginAttemptAllowed,
      recordAdminLoginFailure,
      recordAdminLoginSuccess,
      resetAdminLoginAttempts
    } = await import("../lib/adminSession");
    const key = "admin|127.0.0.1";
    const now = Date.UTC(2026, 3, 26, 12, 0, 0);

    resetAdminLoginAttempts();

    expect(adminLoginAttemptAllowed(key, now)).toBe(true);
    recordAdminLoginFailure(key, now);
    recordAdminLoginFailure(key, now + 1);
    expect(adminLoginAttemptAllowed(key, now + 2)).toBe(true);
    recordAdminLoginFailure(key, now + 2);
    expect(adminLoginAttemptAllowed(key, now + 3)).toBe(false);
    expect(adminLoginAttemptAllowed(key, now + 5 * 60 * 1000 + 3)).toBe(true);
    recordAdminLoginFailure(key, now + 5 * 60 * 1000 + 4);
    recordAdminLoginSuccess(key);
    expect(adminLoginAttemptAllowed(key, now + 5 * 60 * 1000 + 5)).toBe(true);
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
    expect(setCookie).toContain("Max-Age=28800");
  });

  it("sets Secure on login cookies for HTTPS, production, and hosted environments", async () => {
    const { POST } = await import("../app/api/admin/login/route");

    setAdminEnv();
    const httpsResponse = await POST(new Request("https://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));
    expect(httpsResponse.headers.get("set-cookie")).toContain("Secure");

    setAdminEnv({ NODE_ENV: "production" });
    const productionResponse = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));
    expect(productionResponse.headers.get("set-cookie")).toContain("Secure");

    setAdminEnv({ VERCEL: "1" });
    const hostedResponse = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));
    expect(hostedResponse.headers.get("set-cookie")).toContain("Secure");
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

  it("returns 503 and no auth cookie when the admin session secret is weak", async () => {
    setAdminEnv({ GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: WEAK_SESSION_SECRET });
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

  it("returns generic 401 responses after repeated failed login attempts", async () => {
    setAdminEnv();
    const { resetAdminLoginAttempts } = await import("../lib/adminSession");
    const { POST } = await import("../app/api/admin/login/route");
    resetAdminLoginAttempts();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await POST(new Request("http://localhost/api/admin/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "198.51.100.10" },
        body: JSON.stringify({ username: "admin", password: "not-the-password" })
      }));
      expect(response.status).toBe(401);
      await expect(readJson(response)).resolves.toEqual({
        authenticated: false,
        error: "Invalid credentials"
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    }

    const lockedResponse = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "X-Forwarded-For": "198.51.100.10" },
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));
    expect(lockedResponse.status).toBe(401);
    await expect(readJson(lockedResponse)).resolves.toEqual({
      authenticated: false,
      error: "Invalid credentials"
    });
    expect(lockedResponse.headers.get("set-cookie")).toBeNull();
  });

  it("keeps username locked when a client changes spoofable forwarded IP headers", async () => {
    setAdminEnv();
    const { resetAdminLoginAttempts } = await import("../lib/adminSession");
    const { POST } = await import("../app/api/admin/login/route");
    resetAdminLoginAttempts();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await POST(new Request("http://localhost/api/admin/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "198.51.100.10" },
        body: JSON.stringify({ username: "admin", password: "not-the-password" })
      }));
      expect(response.status).toBe(401);
    }

    const spoofedIpResponse = await POST(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.44" },
      body: JSON.stringify({ username: "admin", password: "correct-horse-battery-staple" })
    }));

    expect(spoofedIpResponse.status).toBe(401);
    await expect(readJson(spoofedIpResponse)).resolves.toEqual({
      authenticated: false,
      error: "Invalid credentials"
    });
    expect(spoofedIpResponse.headers.get("set-cookie")).toBeNull();
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

  it("returns authenticated false when admin config becomes unavailable after a cookie was issued", async () => {
    setAdminEnv();
    const { ADMIN_COOKIE_NAME, createAdminSessionValue } = await import("../lib/adminSession");
    const { GET } = await import("../app/api/admin/session/route");
    const sessionValue = createAdminSessionValue();

    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", "");
    const missingUsernameResponse = await GET(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(sessionValue)}` }
    }));

    expect(missingUsernameResponse.status).toBe(200);
    await expect(readJson(missingUsernameResponse)).resolves.toEqual({
      authenticated: false,
      csrf_token: null
    });

    setAdminEnv();
    const secondSessionValue = createAdminSessionValue();
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", "");
    const missingPasswordResponse = await GET(new Request("http://localhost/api/admin/session", {
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(secondSessionValue)}` }
    }));

    expect(missingPasswordResponse.status).toBe(200);
    await expect(readJson(missingPasswordResponse)).resolves.toEqual({
      authenticated: false,
      csrf_token: null
    });
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
