import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";

const loadDashboardSnapshot = vi.fn<() => Promise<AnalyticsSnapshot>>();

vi.mock("../lib/snapshotSource", () => ({
  loadDashboardSnapshot
}));

describe("GET /api/spx/0dte/snapshot/latest", () => {
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
    const response = await GET();

    await expect(response.json()).resolves.toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
