import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { loadClientDashboardSnapshot } from "../lib/clientSnapshotSource";
import { seedSnapshot } from "../lib/seedSnapshot";

function apiSnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "client-api-session",
    mode: "live",
    freshness_ms: 4321,
    rows: [
      {
        ...seedSnapshot.rows[0]!,
        contract_id: "SPXW-CLIENT-C-5200",
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

describe("loadClientDashboardSnapshot", () => {
  it("requests the latest 0DTE SPX snapshot from the relative API route", async () => {
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await loadClientDashboardSnapshot({ fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/snapshot/latest", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a valid API snapshot", async () => {
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBe(snapshot);
  });

  it("returns null when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBeNull();
  });

  it("returns null for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBeNull();
  });

  it("returns null for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), symbol: "NDX" }));

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBeNull();
  });

  it("returns null for payloads missing required contract top-level fields", async () => {
    const { discount_factor: _discountFactor, ...payload } = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBeNull();
  });

  it("returns null for rows missing required contract fields", async () => {
    const { contract_id: _contractId, ...row } = apiSnapshot().rows[0]!;
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), rows: [row] }));

    await expect(loadClientDashboardSnapshot({ fetcher })).resolves.toBeNull();
  });
});
