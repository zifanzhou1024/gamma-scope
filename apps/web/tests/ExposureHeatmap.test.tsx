// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { HeatmapPayload } from "../lib/clientHeatmapSource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const basePayload = {
  sessionId: "heatmap-session",
  symbol: "SPX",
  tradingClass: "SPXW",
  dte: 0,
  expirationDate: "2026-04-28",
  spot: 5201.25,
  metric: "gex",
  positionMode: "oi_proxy",
  oiBaselineStatus: "provisional",
  oiBaselineCapturedAt: null,
  lastSyncedAt: "2026-04-28T15:45:12Z",
  isLive: true,
  isStale: false,
  persistenceStatus: "unavailable",
  nodes: {
    king: { strike: 5200, value: 1250000 },
    positiveKing: { strike: 5225, value: 980000 },
    negativeKing: { strike: 5175, value: -810000 },
    aboveWall: { strike: 5250, value: 520000 },
    belowWall: { strike: 5150, value: -460000 }
  },
  rows: [
    {
      strike: 5175,
      value: -810000,
      formattedValue: "-$810K",
      callValue: 110000,
      putValue: -920000,
      colorNorm: 0.66,
      gex: -810000,
      vex: -120000,
      callGex: 110000,
      putGex: -920000,
      callVex: 30000,
      putVex: -150000,
      colorNormGex: 0.66,
      colorNormVex: 0.24,
      tags: ["negative_king", "below_wall"]
    },
    {
      strike: 5200,
      value: 1250000,
      formattedValue: "$1.3M",
      callValue: 760000,
      putValue: 490000,
      colorNorm: 1,
      gex: 1250000,
      vex: 340000,
      callGex: 760000,
      putGex: 490000,
      callVex: 210000,
      putVex: 130000,
      colorNormGex: 1,
      colorNormVex: 0.68,
      tags: ["king"]
    },
    {
      strike: 5225,
      value: 980000,
      formattedValue: "$980K",
      callValue: 620000,
      putValue: 360000,
      colorNorm: 0.78,
      gex: 980000,
      vex: 500000,
      callGex: 620000,
      putGex: 360000,
      callVex: 290000,
      putVex: 210000,
      colorNormGex: 0.78,
      colorNormVex: 1,
      tags: ["positive_king", "above_wall"]
    }
  ]
} satisfies HeatmapPayload;

describe("ExposureHeatmap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the latest ladder, node badges, and warning disclosures", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);

    expect(container.textContent).toContain("SPXW");
    expect(container.textContent).toContain("5,201.25");
    expect(container.textContent).toContain("LIVE");
    expect(container.textContent).toContain("11:45:12 AM");
    expect(container.textContent).toContain("5,175");
    expect(container.textContent).toContain("-$810K");
    expect(container.textContent).toContain("King");
    expect(container.textContent).toContain("Positive king");
    expect(container.textContent).toContain("Negative king");
    expect(container.textContent).toContain("Above wall");
    expect(container.textContent).toContain("Below wall");
    expect(container.textContent).toContain("Open interest is an intraday proxy");
    expect(container.textContent).toContain("Provisional baseline");
    expect(container.textContent).toContain("Persistence unavailable");
    expect(container.querySelector(".heatmapCell-positive")).not.toBeNull();
    expect(container.querySelector(".heatmapCell-negative")).not.toBeNull();

    cleanup(root, container);
  });

  it("switches displayed metric locally from GEX to VEX without refetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);

    const table = getHeatmapTable(container);
    expect(table.textContent).toContain("$1.3M");
    expect(table.textContent).not.toContain("$340K");

    clickButton(container, "VEX");

    expect(table.textContent).toContain("$340K");
    expect(table.textContent).toContain("$500K");
    expect(table.textContent).not.toContain("$1.3M");
    expect(fetchSpy).not.toHaveBeenCalled();

    cleanup(root, container);
  });

  it("centers nearest spot and king rows when toolbar controls are used", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);

    clickButton(container, "Center spot");
    clickButton(container, "Center king");

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-heatmap-row=\"5200\"]")).not.toBeNull();

    cleanup(root, container);
  });
});

function renderHeatmap(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
  expect(button).not.toBeNull();

  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getHeatmapTable(container: HTMLElement): HTMLTableElement {
  const table = container.querySelector<HTMLTableElement>(".heatmapTable");
  expect(table).not.toBeNull();
  return table as HTMLTableElement;
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
