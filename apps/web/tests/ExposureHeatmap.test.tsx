// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { HeatmapPayload } from "../lib/clientHeatmapSource";
// @ts-expect-error Test mock below exposes the storage key without changing the shared component module.
import { THEME_STORAGE_KEY } from "../components/ThemeToggle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/ThemeToggle", async () => {
  const actual = await vi.importActual<typeof import("../components/ThemeToggle")>("../components/ThemeToggle");
  const themePreference = await vi.importActual<typeof import("../lib/themePreference")>("../lib/themePreference");

  return {
    ...actual,
    THEME_STORAGE_KEY: themePreference.THEME_STORAGE_KEY
  };
});

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
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the shared theme switch in the heatmap header", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    await act(async () => undefined);

    const html = container.innerHTML;
    const headerIndex = html.indexOf("heatmapHeader");
    const navIndex = html.indexOf("topNavTabs");
    const themeToggleIndex = html.indexOf("data-theme-toggle");
    const statusIndex = html.indexOf("Heatmap status");
    const button = getThemeToggleButton(container);

    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(navIndex).toBeGreaterThan(headerIndex);
    expect(themeToggleIndex).toBeGreaterThan(navIndex);
    expect(statusIndex).toBeGreaterThan(themeToggleIndex);
    expect(button.textContent).toContain("Theme");
    expect(button.textContent).toContain("Dark");

    cleanup(root, container);
  });

  it("toggles the shared light theme from the heatmap header", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    const button = getThemeToggleButton(container);
    await act(async () => undefined);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Light");

    cleanup(root, container);
  });

  it("loads a saved light preference in the heatmap header", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    const button = getThemeToggleButton(container);
    await act(async () => undefined);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Light");

    cleanup(root, container);
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
    expect(container.textContent).toContain("OI proxy / estimated dealer exposure");
    expect(container.textContent).toContain("Open interest is an intraday proxy");
    expect(container.textContent).toContain("Provisional baseline");
    expect(container.textContent).toContain("Persistence unavailable");
    expect(container.querySelector(".heatmapCell-positive")).not.toBeNull();
    expect(container.querySelector(".heatmapCell-negative")).not.toBeNull();

    cleanup(root, container);
  });

  it("renders higher strikes above lower strikes", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);

    expect(getRenderedStrikes(container)).toEqual([5225, 5200, 5175]);

    cleanup(root, container);
  });

  it("defaults to three visible columns and can add or reorder extra tickers", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const payloads = [
      basePayload,
      symbolPayload("SPY", "SPY", 715.17, 715),
      symbolPayload("QQQ", "QQQ", 664.23, 665),
      symbolPayload("NDX", "NDX", 18300, 18300),
      symbolPayload("IWM", "IWM", 277.14, 277)
    ];
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayloads={payloads} />);

    let panels = Array.from(container.querySelectorAll<HTMLElement>(".heatmapPanel"));
    expect(panels).toHaveLength(3);
    expect(panels.map((panel) => panel.querySelector(".heatmapPanelSymbol")?.textContent)).toEqual([
      "SPXW",
      "SPY",
      "QQQ"
    ]);
    expect(container.querySelector(".heatmapPanels")?.getAttribute("data-column-count")).toBe("3");
    expect(panels[1]?.querySelector("[data-heatmap-row=\"715\"]")).not.toBeNull();
    expect(panels[2]?.querySelector("[data-heatmap-row=\"665\"]")).not.toBeNull();

    clickButton(container, "NDX");
    clickButton(container, "IWM");

    panels = Array.from(container.querySelectorAll<HTMLElement>(".heatmapPanel"));
    expect(panels).toHaveLength(5);
    expect(panels.map((panel) => panel.querySelector(".heatmapPanelSymbol")?.textContent)).toEqual([
      "SPXW",
      "SPY",
      "QQQ",
      "NDX",
      "IWM"
    ]);
    expect(container.querySelector(".heatmapPanels")?.getAttribute("data-column-count")).toBe("5");

    clickButton(container, "Move NDX left");

    panels = Array.from(container.querySelectorAll<HTMLElement>(".heatmapPanel"));
    expect(panels.map((panel) => panel.querySelector(".heatmapPanelSymbol")?.textContent)).toEqual([
      "SPXW",
      "SPY",
      "NDX",
      "QQQ",
      "IWM"
    ]);

    cleanup(root, container);
  });

  it("marks both the nearest spot row and selected metric king row in each ladder", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);
    const markedRow = getRow(container, 5200);

    expect(markedRow.classList.contains("heatmapSpotRow")).toBe(true);
    expect(markedRow.classList.contains("heatmapKingRow")).toBe(true);
    expect(markedRow.querySelector(".heatmapRowBadge-spot")?.textContent).toBe("Spot");
    expect(markedRow.querySelector(".heatmapRowBadge-king")?.textContent).toBe("King");

    cleanup(root, container);
  });

  it("keeps the ladder focused on one net metric column and moves components into hover detail", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={basePayload} />);

    const headers = Array.from(getHeatmapTable(container).querySelectorAll("th")).map((header) => header.textContent);
    expect(headers).toEqual(["Strike", "GEX"]);
    expect(getHeatmapTable(container).textContent).not.toContain("Call GEX");
    expect(getHeatmapTable(container).textContent).not.toContain("Put GEX");
    expect(getRow(container, 5200).textContent).not.toContain("$760K");
    expect(getRow(container, 5200).textContent).toContain("King");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Call GEX: $760K");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Put GEX: $490K");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Tags: King");

    clickButton(container, "VEX");

    const vexHeaders = Array.from(getHeatmapTable(container).querySelectorAll("th")).map((header) => header.textContent);
    expect(vexHeaders).toEqual(["Strike", "VEX"]);
    expect(getHeatmapTable(container).textContent).not.toContain("Call VEX");
    expect(getHeatmapTable(container).textContent).not.toContain("Put VEX");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Call VEX: $210K");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Put VEX: $130K");

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

  it("derives node detail from the selected metric without cluttering the ladder", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={metricDivergentPayload} />);

    expect(getNodePanel(container).textContent).toContain("5000 $900K");
    expect(getRow(container, 5000).textContent).toContain("King");
    expect(getMetricCell(container, 5000).getAttribute("title")).toContain("Tags: King");

    clickButton(container, "VEX");

    expect(getNodePanel(container).textContent).toContain("5500 $1.1M");
    expect(getNodePanel(container).textContent).toContain("Positive king5500 $1.1M");
    expect(getNodePanel(container).textContent).toContain("5490 -$700K");
    expect(getNodePanel(container).textContent).toContain("Above wall5010 $20K");
    expect(getNodePanel(container).textContent).toContain("Below wall4990 $20K");
    expect(getRow(container, 5000).textContent).not.toContain("King");
    clickButton(container, "Center king");
    expect(getRow(container, 5500).textContent).toContain("King");
    expect(getMetricCell(container, 5500).getAttribute("title")).toContain("Tags: King, Positive King");
    expect(getMetricCell(container, 5010).getAttribute("title")).toContain("Tags: Above Wall");
    expect(getMetricCell(container, 4990).getAttribute("title")).toContain("Tags: Below Wall");
    expect(fetchSpy).not.toHaveBeenCalled();

    cleanup(root, container);
  });

  it("preserves backend data-quality tags while deriving node tags for the selected metric", async () => {
    const payload = {
      ...basePayload,
      rows: basePayload.rows.map((row) =>
        row.strike === 5200
          ? { ...row, tags: ["king", "missing_greek", "missing_oi_baseline"] }
          : row
      )
    } satisfies HeatmapPayload;
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={payload} />);

    expect(getRow(container, 5200).textContent).toContain("King");
    expect(getRow(container, 5200).textContent).not.toContain("Missing Greek");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Tags: Missing Greek, Missing Oi Baseline, King");

    clickButton(container, "VEX");

    expect(getMetricCell(container, 5200).getAttribute("title")).not.toContain("King");
    expect(getMetricCell(container, 5200).getAttribute("title")).toContain("Tags: Missing Greek, Missing Oi Baseline");

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

    expect(getMetricCell(container, 110).getAttribute("title")).toContain("Tags: King, Positive King, Above Wall");
    expect(getMetricCell(container, 98).getAttribute("title")).toContain("Tags: Negative King, Below Wall");
    expect(getRow(container, 90).textContent).not.toContain("King");

    cleanup(root, container);
  });

  it("uses interpolated 80th percentile for wall eligibility", async () => {
    const { ExposureHeatmap } = await import("../components/ExposureHeatmap");
    const { container, root } = renderHeatmap(<ExposureHeatmap initialPayload={interpolatedPercentilePayload} />);

    expect(getNodePanel(container).textContent).toContain("Above wall110 $100");
    expect(getNodePanel(container).textContent).toContain("Below wall90 -$100");
    expect(getNodePanel(container).textContent).not.toContain("Above wall101 $40");
    expect(getMetricCell(container, 110).getAttribute("title")).toContain("Tags: Positive King, Above Wall");
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

function symbolPayload(symbol: "SPY" | "QQQ" | "NDX" | "IWM", tradingClass: string, spot: number, strike: number): HeatmapPayload {
  return {
    ...basePayload,
    sessionId: `moomoo-${symbol.toLowerCase()}-0dte-live`,
    symbol,
    tradingClass,
    spot,
    rows: [
      {
        ...basePayload.rows[1],
        strike,
        value: 510000,
        formattedValue: "$510K",
        gex: 510000,
        colorNormGex: 0.72,
        tags: ["king"]
      }
    ],
    nodes: {
      king: { strike, value: 510000 },
      positiveKing: { strike, value: 510000 },
      negativeKing: null,
      aboveWall: null,
      belowWall: null
    }
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
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent === label || candidate.getAttribute("aria-label") === label
  );
  expect(button).not.toBeNull();

  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getThemeToggleButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[data-theme-toggle]");
  if (!button) {
    throw new Error("Missing button[data-theme-toggle]");
  }
  return button;
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

function getMetricCell(container: HTMLElement, strike: number): HTMLElement {
  const cell = getRow(container, strike).querySelector<HTMLElement>(".heatmapCell");
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

function getRenderedStrikes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-heatmap-row]")).map((row) =>
    Number(row.dataset.heatmapRow)
  );
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
