import { describe, expect, it, vi } from "vitest";
import { loadLatestHeatmaps } from "../lib/serverHeatmapSource";
import type { HeatmapPayload } from "../lib/clientHeatmapSource";

describe("loadLatestHeatmaps", () => {
  it("keeps all supported panel slots when a symbol request is unavailable", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const symbol = new URL(input).searchParams.get("symbol");

      if (symbol === "SPY") {
        return new Response(JSON.stringify({ error: "not ready" }), { status: 404 });
      }

      return new Response(JSON.stringify(heatmapPayload(toSupportedSymbol(symbol))), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    });

    const payloads = await loadLatestHeatmaps(fetcher as typeof fetch, new Headers({ host: "gamma.test" }));

    expect(payloads.map((payload) => payload.symbol)).toEqual(["SPX", "SPY", "QQQ", "NDX", "IWM"]);
    expect(payloads[1]).toMatchObject({
      symbol: "SPY",
      tradingClass: "SPY",
      persistenceStatus: "unavailable",
      rows: []
    });
  });

  it("uses an unavailable slot when an upstream response does not match the requested symbol", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(heatmapPayload("SPX")), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    });

    const payloads = await loadLatestHeatmaps(fetcher as typeof fetch, new Headers({ host: "gamma.test" }));

    expect(payloads.map((payload) => payload.symbol)).toEqual(["SPX", "SPY", "QQQ", "NDX", "IWM"]);
    expect(payloads.slice(1).every((payload) => payload.persistenceStatus === "unavailable")).toBe(true);
  });
});

function toSupportedSymbol(symbol: string | null): "SPX" | "QQQ" | "NDX" | "IWM" {
  return symbol === "QQQ" || symbol === "NDX" || symbol === "IWM" ? symbol : "SPX";
}

function heatmapPayload(symbol: "SPX" | "QQQ" | "NDX" | "IWM"): HeatmapPayload {
  return {
    sessionId: `moomoo-${symbol.toLowerCase()}-0dte-live`,
    symbol,
    tradingClass: symbol === "SPX" ? "SPXW" : symbol,
    dte: 0,
    expirationDate: "2026-04-28",
    spot: symbol === "SPX" ? 7159.35 : 664.23,
    metric: "gex",
    positionMode: "oi_proxy",
    oiBaselineStatus: "locked",
    oiBaselineCapturedAt: "2026-04-28T13:25:00Z",
    lastSyncedAt: "2026-04-28T15:45:12Z",
    isLive: true,
    isStale: false,
    persistenceStatus: "persisted",
    rows: [],
    nodes: {
      king: null,
      positiveKing: null,
      negativeKing: null,
      aboveWall: null,
      belowWall: null
    }
  };
}
