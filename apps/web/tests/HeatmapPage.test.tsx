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
    vi.resetModules();
    mocks.heatmapProps.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers());
  });

  it("renders the heatmap shell with the latest ladder payload", async () => {
    mocks.requestHeaders.mockReturnValue(new Headers({
      cookie: "gammascope_admin=signed-session",
      host: "gammascope.test",
      "x-forwarded-proto": "https"
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(latestPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })));
    vi.stubGlobal("React", React);

    const { default: HeatmapPage } = await import("../app/heatmap/page");
    const page = await HeatmapPage();

    expect(renderToStaticMarkup(page)).toContain("Heatmap page shell");
    expect(fetch).toHaveBeenCalledWith("https://gammascope.test/api/spx/0dte/heatmap/latest?metric=gex", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: "gammascope_admin=signed-session"
      }
    });
    expect(mocks.heatmapProps).toHaveBeenCalledWith({ initialPayload: latestPayload });
  });
});

const latestPayload = {
  sessionId: "latest-heatmap-session",
  symbol: "SPX",
  tradingClass: "SPXW",
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
