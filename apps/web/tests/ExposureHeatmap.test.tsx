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

const metricDivergentPayload = {
  ...basePayload,
  spot: 5000,
  nodes: {
    king: { strike: 5000, value: 900000 },
    positiveKing: { strike: 5010, value: 600000 },
    negativeKing: { strike: 5020, value: -500000 },
    aboveWall: { strike: 5030, value: 300000 },
    belowWall: { strike: 4990, value: -250000 }
  },
  rows: Array.from({ length: 56 }, (_, index) => {
    const strike = 4990 + index * 10;
    return {
      strike,
      value: strike === 5000 ? 900000 : strike === 5020 ? -500000 : 10000,
      formattedValue: strike === 5000 ? "$900K" : strike === 5020 ? "-$500K" : "$10K",
      callValue: 1000,
      putValue: 1000,
      colorNorm: strike === 5000 ? 1 : 0.1,
      gex: strike === 5000 ? 900000 : strike === 5020 ? -500000 : 10000,
      vex: strike === 5500 ? 1100000 : strike === 5490 ? -700000 : strike === 5480 ? 800000 : strike === 5470 ? 500000 : strike === 5510 ? -450000 : 20000,
      callGex: 1000,
      putGex: 1000,
      callVex: 1000,
      putVex: 1000,
      colorNormGex: strike === 5000 ? 1 : 0.1,
      colorNormVex: strike === 5500 ? 1 : 0.1,
      tags: strike === 5000 ? ["king"] : strike === 5030 ? ["above_wall"] : strike === 4990 ? ["below_wall"] : []
    };
  })
} satisfies HeatmapPayload;

const backendNodeRulesPayload = {
  ...basePayload,
  spot: 100,
  nodes: {
    king: null,
    positiveKing: null,
    negativeKing: null,
    aboveWall: null,
    belowWall: null
  },
  rows: [
    nodeRuleRow(70, 10),
    nodeRuleRow(75, -20),
    nodeRuleRow(80, -30),
    nodeRuleRow(85, 40),
    nodeRuleRow(88, 50),
    nodeRuleRow(90, 0),
    nodeRuleRow(95, Number.NaN),
    nodeRuleRow(96, -70),
    nodeRuleRow(98, -920),
    nodeRuleRow(99, 0),
    nodeRuleRow(101, 900),
    nodeRuleRow(102, 60),
    nodeRuleRow(110, 1000),
    nodeRuleRow(120, Number.POSITIVE_INFINITY)
  ]
} as HeatmapPayload;

const interpolatedPercentilePayload = {
  ...basePayload,
  spot: 100,
  nodes: {
    king: null,
    positiveKing: null,
    negativeKing: null,
    aboveWall: null,
    belowWall: null
  },
  rows: [
    nodeRuleRow(70, 1),
    nodeRuleRow(75, 2),
    nodeRuleRow(80, 3),
    nodeRuleRow(85, 4),
    nodeRuleRow(88, 5),
    nodeRuleRow(90, -100),
    nodeRuleRow(94, 6),
    nodeRuleRow(99, -7),
    nodeRuleRow(101, 40),
    nodeRuleRow(110, 100)
  ]
} as HeatmapPayload;

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

  it("derives node badges and row tags from the selected metric without refetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={metricDivergentPayload} />);

    expect(getNodePanel(container).textContent).toContain("5000 $900K");
    expect(getRow(container, 5000).textContent).toContain("King");

    clickButton(container, "VEX");

    expect(getNodePanel(container).textContent).toContain("5500 $1.1M");
    expect(getNodePanel(container).textContent).toContain("Positive king5500 $1.1M");
    expect(getNodePanel(container).textContent).toContain("5490 -$700K");
    expect(getNodePanel(container).textContent).toContain("Above wall5010 $20K");
    expect(getNodePanel(container).textContent).toContain("Below wall4990 $20K");
    expect(getRow(container, 5000).textContent).not.toContain("King");
    clickButton(container, "Center king");
    expect(getRow(container, 5500).textContent).toContain("King");
    expect(getRow(container, 5500).textContent).toContain("Positive King");
    expect(getRow(container, 5010).textContent).toContain("Above Wall");
    expect(getRow(container, 4990).textContent).toContain("Below Wall");
    expect(fetchSpy).not.toHaveBeenCalled();

    cleanup(root, container);
  });

  it("renders and centers the selected metric king when it is outside the current spot window", async () => {
    const scrolledRows: string[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: HTMLElement) {
        scrolledRows.push(this.dataset.heatmapRow ?? "");
      }
    });
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={metricDivergentPayload} />);

    expect(container.querySelector("[data-heatmap-row=\"5500\"]")).toBeNull();

    clickButton(container, "VEX");
    clickButton(container, "Center king");

    expect(container.querySelector("[data-heatmap-row=\"5500\"]")).not.toBeNull();
    expect(scrolledRows).toEqual(["5500"]);

    cleanup(root, container);
  });

  it("renders a clear unavailable state when no snapshot is provided", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={null} />);

    expect(container.textContent).toContain("No heatmap snapshot is available.");
    expect(container.textContent).not.toContain("Loading latest heatmap ladder.");

    cleanup(root, container);
  });

  it("matches backend node rules for selected metric nodes and tags", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={backendNodeRulesPayload} />);

    expect(getNodePanel(container).textContent).toContain("King110 $1K");
    expect(getNodePanel(container).textContent).toContain("Positive king110 $1K");
    expect(getNodePanel(container).textContent).toContain("Negative king98 -$920");
    expect(getNodePanel(container).textContent).toContain("Above wall110 $1K");
    expect(getNodePanel(container).textContent).toContain("Below wall98 -$920");
    expect(getNodePanel(container).textContent).not.toContain("90 $0");
    expect(getNodePanel(container).textContent).not.toContain("120 $Infinity");

    expect(getRow(container, 110).textContent).toContain("King");
    expect(getRow(container, 110).textContent).toContain("Positive King");
    expect(getRow(container, 98).textContent).toContain("Negative King");
    expect(getRow(container, 98).textContent).toContain("Below Wall");
    expect(getRow(container, 110).textContent).toContain("Above Wall");
    expect(getRow(container, 90).textContent).not.toContain("King");

    cleanup(root, container);
  });

  it("uses interpolated 80th percentile for wall eligibility", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={interpolatedPercentilePayload} />);

    expect(getNodePanel(container).textContent).toContain("Above wall110 $100");
    expect(getNodePanel(container).textContent).toContain("Below wall90 -$100");
    expect(getNodePanel(container).textContent).not.toContain("Above wall101 $40");
    expect(getRow(container, 110).textContent).toContain("Above Wall");
    expect(getRow(container, 101).textContent).not.toContain("Above Wall");

    cleanup(root, container);
  });
});

function nodeRuleRow(strike: number, gex: number) {
  return {
    strike,
    value: gex,
    formattedValue: "$0",
    callValue: 0,
    putValue: 0,
    colorNorm: Number.isFinite(gex) ? 0.5 : 0,
    gex,
    vex: 0,
    callGex: 0,
    putGex: 0,
    callVex: 0,
    putVex: 0,
    colorNormGex: Number.isFinite(gex) ? 0.5 : 0,
    colorNormVex: 0,
    tags: []
  };
}

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

function getNodePanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>(".heatmapNodePanel");
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

function getRow(container: HTMLElement, strike: number): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-heatmap-row="${strike}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
