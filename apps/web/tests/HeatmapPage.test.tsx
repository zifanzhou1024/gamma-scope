import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const heatmapProps = vi.fn();

vi.mock("../components/ExposureHeatmap", () => ({
  ExposureHeatmap: (props: unknown) => {
    heatmapProps(props);
    return <div>Heatmap page shell</div>;
  }
}));

describe("HeatmapPage", () => {
  it("renders the heatmap shell with the latest ladder payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(latestPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })));
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://analytics.local");
    vi.stubGlobal("React", React);

    const { default: HeatmapPage } = await import("../app/heatmap/page");
    const page = await HeatmapPage();

    expect(renderToStaticMarkup(page)).toContain("Heatmap page shell");
    expect(fetch).toHaveBeenCalledWith("http://analytics.local/api/spx/0dte/heatmap/latest?metric=gex", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
    expect(heatmapProps).toHaveBeenCalledWith({ initialPayload: latestPayload });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    heatmapProps.mockReset();
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
