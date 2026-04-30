import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE_NAME, createAdminSessionValue } from "../lib/adminSession";
import { loadDashboardSnapshot } from "../lib/serverSnapshotSource";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";

function apiSnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "api-session",
    mode: "live",
    freshness_ms: 1234,
    rows: [
      {
        ...seedSnapshot.rows[0]!,
        contract_id: "SPXW-API-C-5200",
        strike: 5200
      }
    ]
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("loadDashboardSnapshot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests the latest 0DTE SPX snapshot from the configured API base URL", async () => {
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://testserver/api/spx/0dte/snapshot/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a successful API snapshot", async () => {
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(snapshot);
  });

  it("uses the API base URL from the environment by default", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://envserver/");
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await loadDashboardSnapshot({ fetcher });

    expect(fetcher).toHaveBeenCalledWith("http://envserver/api/spx/0dte/snapshot/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("forwards the backend admin token for a valid server admin session", async () => {
    vi.stubEnv("GAMMASCOPE_ADMIN_TOKEN", "api-admin-token");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", "admin");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", "password");
    vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", "x".repeat(32));
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));
    const sessionCookie = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(createAdminSessionValue())}`;

    await loadDashboardSnapshot({
      apiBaseUrl: "http://testserver",
      fetcher,
      requestHeaders: new Headers({
        cookie: sessionCookie,
        host: "gamma.local"
      })
    });

    expect(fetcher).toHaveBeenCalledWith("http://testserver/api/spx/0dte/snapshot/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": "api-admin-token"
      }
    });
  });

  it("falls back to the seed snapshot when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for payloads without the supported schema version", async () => {
    const { schema_version: _schemaVersion, ...payload } = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for non-SPX payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), symbol: "NDX" }));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot when rows is not an array", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), rows: null }));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for minimal payloads missing dashboard top-level fields", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ schema_version: "1.0.0", symbol: "SPX", rows: [] }));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for rows missing dashboard fields", async () => {
    const { custom_gamma: _customGamma, ...row } = seedSnapshot.rows[0]!;
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), rows: [row] }));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for payloads missing required contract top-level fields", async () => {
    const { discount_factor: _discountFactor, ...payload } = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });

  it("falls back to the seed snapshot for rows missing required contract fields", async () => {
    const { contract_id: _contractId, ...row } = apiSnapshot().rows[0]!;
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), rows: [row] }));

    await expect(loadDashboardSnapshot({ apiBaseUrl: "http://testserver", fetcher })).resolves.toBe(seedSnapshot);
  });
});
