import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";

const loadDashboardSnapshot = vi.fn();

vi.mock("../lib/serverSnapshotSource", () => ({
  loadDashboardSnapshot
}));

describe("GET /api/spx/0dte/snapshot/latest", () => {
  afterEach(() => {
    loadDashboardSnapshot.mockReset();
    vi.resetModules();
  });

  it("returns the latest dashboard snapshot without caching", async () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "route-test-session",
      mode: "live",
      spot: 5212.75,
      rows: [
        {
          ...seedSnapshot.rows[0]!,
          gamma_diff: 0
        }
      ]
    } satisfies AnalyticsSnapshot;
    loadDashboardSnapshot.mockResolvedValue(snapshot);

    const { GET } = await import("../app/api/spx/0dte/snapshot/latest/route");
    const request = new Request("http://localhost/api/spx/0dte/snapshot/latest", {
      headers: {
        cookie: "gammascope_admin=signed-session"
      }
    });
    const response = await GET(request);

    await expect(response.json()).resolves.toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(loadDashboardSnapshot).toHaveBeenCalledWith({
      requestHeaders: request.headers
    });
  });
});
