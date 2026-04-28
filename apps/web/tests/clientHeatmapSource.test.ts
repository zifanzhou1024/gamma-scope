import { describe, expect, it, vi } from "vitest";
import { isHeatmapPayload, loadClientHeatmap, type HeatmapPayload } from "../lib/clientHeatmapSource";

function heatmapPayload(overrides: Partial<HeatmapPayload> = {}): HeatmapPayload {
  return {
    sessionId: "heatmap-session-1",
    symbol: "SPX",
    tradingClass: "SPXW",
    dte: 0,
    expirationDate: "2026-04-28",
    spot: 7173.91,
    metric: "gex",
    positionMode: "oi_proxy",
    oiBaselineStatus: "locked",
    oiBaselineCapturedAt: "2026-04-28T13:25:02Z",
    lastSyncedAt: "2026-04-28T14:00:44Z",
    isLive: true,
    isStale: false,
    persistenceStatus: "persisted",
    rows: [
      {
        strike: 7175,
        value: -31_800_000,
        formattedValue: "-$31.8M",
        callValue: 12_000_000,
        putValue: -43_800_000,
        colorNorm: 1,
        gex: -31_800_000,
        vex: 4_200_000,
        callGex: 12_000_000,
        putGex: -43_800_000,
        callVex: 5_100_000,
        putVex: -900_000,
        colorNormGex: 1,
        colorNormVex: 0.45,
        tags: ["king", "near_spot"]
      }
    ],
    nodes: {
      king: { strike: 7175, value: -31_800_000 },
      positiveKing: { strike: 7200, value: 12_400_000 },
      negativeKing: { strike: 7175, value: -31_800_000 },
      aboveWall: { strike: 7200, value: 12_400_000 },
      belowWall: null
    },
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("isHeatmapPayload", () => {
  it("accepts valid heatmap payloads with full stored row fields", () => {
    expect(isHeatmapPayload(heatmapPayload())).toBe(true);
  });

  it("rejects malformed payload core fields", () => {
    expect(isHeatmapPayload({ ...heatmapPayload(), symbol: "NDX" })).toBe(false);
    expect(isHeatmapPayload({ ...heatmapPayload(), tradingClass: "SPX" })).toBe(false);
    expect(isHeatmapPayload({ ...heatmapPayload(), metric: "charm" })).toBe(false);
    expect(isHeatmapPayload({ ...heatmapPayload(), dte: "0" })).toBe(false);
    expect(isHeatmapPayload({ ...heatmapPayload(), oiBaselineStatus: "available" })).toBe(false);
    expect(isHeatmapPayload({ ...heatmapPayload(), persistenceStatus: "ready" })).toBe(false);
  });

  it("rejects rows missing required stored metric fields", () => {
    const { callVex: _callVex, ...row } = heatmapPayload().rows[0]!;

    expect(isHeatmapPayload({ ...heatmapPayload(), rows: [row] })).toBe(false);
  });

  it("accepts nullable DTE and nullable OI baseline capture time", () => {
    expect(isHeatmapPayload(heatmapPayload({ dte: null, oiBaselineCapturedAt: null }))).toBe(true);
  });
});

describe("loadClientHeatmap", () => {
  it("requests the latest heatmap metric from the relative API route", async () => {
    const payload = heatmapPayload({ metric: "vex" });
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await loadClientHeatmap("vex", { fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/heatmap/latest?metric=vex", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("defaults to the GEX metric and returns valid payloads", async () => {
    const payload = heatmapPayload();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadClientHeatmap(undefined, { fetcher })).resolves.toBe(payload);
    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/heatmap/latest?metric=gex", expect.any(Object));
  });

  it("returns null for fetch failures, non-OK responses, and invalid payloads", async () => {
    await expect(loadClientHeatmap("gex", {
      fetcher: vi.fn(async () => {
        throw new Error("offline");
      })
    })).resolves.toBeNull();

    await expect(loadClientHeatmap("gex", {
      fetcher: vi.fn(async () => jsonResponse({ error: "unavailable" }, false))
    })).resolves.toBeNull();

    await expect(loadClientHeatmap("gex", {
      fetcher: vi.fn(async () => jsonResponse({ ...heatmapPayload(), rows: "nope" }))
    })).resolves.toBeNull();
  });
});
