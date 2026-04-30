import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  heatmapProps: vi.fn(),
  requestHeaders: vi.fn(() => new Headers())
}));

vi.mock("../components/ExposureHeatmap", () => ({
  ExposureHeatmap: (props: unknown) => {
    mocks.heatmapProps(props);
    return <div>Heatmap page shell</div>;
  }
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mocks.requestHeaders())
}));

describe("HeatmapPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    mocks.heatmapProps.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers());
  });

  it("renders the heatmap shell with all supported latest ladder payloads", async () => {
    mocks.requestHeaders.mockReturnValue(new Headers({
      cookie: "gammascope_admin=signed-session",
      host: "gammascope.test",
      "x-forwarded-proto": "https"
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(payloadForUrl(input)), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })));
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");
    vi.stubGlobal("React", React);

    const { default: HeatmapPage } = await import("../app/heatmap/page");
    const page = await HeatmapPage();

    expect(renderToStaticMarkup(page)).toContain("Heatmap page shell");
    expect(fetch).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=SPX", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
    expect(fetch).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=SPY", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=QQQ", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=NDX", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=IWM", expect.any(Object));
    expect(mocks.heatmapProps).toHaveBeenCalledWith({
      initialPayloads: [
        heatmapPayload("SPX", "SPXW"),
        heatmapPayload("SPY", "SPY"),
        heatmapPayload("QQQ", "QQQ"),
        heatmapPayload("NDX", "NDX"),
        heatmapPayload("IWM", "IWM")
      ]
    });
  });
});

function payloadForUrl(input: string) {
  const symbol = new URL(input).searchParams.get("symbol") ?? "SPX";
  if (symbol === "SPY" || symbol === "QQQ" || symbol === "NDX" || symbol === "IWM") {
    return heatmapPayload(symbol, symbol);
  }
  return heatmapPayload("SPX", "SPXW");
}

function heatmapPayload(symbol: "SPX" | "SPY" | "QQQ" | "NDX" | "IWM", tradingClass: string) {
  return {
  sessionId: "latest-heatmap-session",
  symbol,
  tradingClass,
  dte: 0,
  expirationDate: "2026-04-28",
  spot: 5201.25,
  metric: "gex",
  positionMode: "oi_proxy",
  oiBaselineStatus: "locked",
  oiBaselineCapturedAt: "2026-04-28T13:30:00Z",
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
