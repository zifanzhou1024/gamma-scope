// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;
const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  loadClientExperimentalAnalytics: vi.fn()
}));

vi.mock("../lib/clientExperimentalAnalyticsSource", () => ({
  loadClientExperimentalAnalytics: mocks.loadClientExperimentalAnalytics
}));

describe("ExperimentalDashboard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mocks.loadClientExperimentalAnalytics.mockReset();
  });

  it("renders an active Experimental nav tab and a dense KPI strip", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={seedPayload} />);

    expect(markup).toContain("SPX 0DTE experimental");
    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Realtime<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/replay"[^>]*>Replay<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/heatmap"[^>]*>Heatmap<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/experimental"[^>]*aria-current="page"[^>]*>Experimental<\/a>/);
    expect(markup).toContain("seed-spx-2026-04-23");
    expect(markup).toContain("Forward and expected move");
    expect(markup).toContain("Parity forward");
    expect(markup).toContain("Forward-minus-spot");
    expect(markup).toContain("ATM straddle");
    expect(markup).toContain("Expected range");
    expect(markup).toContain("Expected move");
    expect(markup).toContain("Quote quality");
    expect(markup).toContain("94.0%");
  });

  it("renders IV smile methods and terminal distribution charts with stable SVG frames", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={seedPayload} />);

    expect(markup).toContain('aria-label="IV smile methods chart"');
    expect(markup).toContain('viewBox="0 0 640 340"');
    expect(markup).toContain("Strike");
    expect(markup).toContain("IV (%)");
    expect(markup).toContain("Current custom IV");
    expect(markup).toContain("Spline fit");
    expect(markup).toContain("data-series-key=\"custom_iv\"");
    expect(markup).toContain("data-series-key=\"spline_fit\"");
    expect(markup).toContain('aria-label="Terminal distribution chart"');
    expect(markup).toContain("Expiry level");
    expect(markup).toContain("Density");
    expect(markup).toContain("Highest density");
    expect(markup).toContain("5195-5205");
    expect(markup).toContain("68% range");
    expect(markup).toContain("95% range");
  });

  it("renders nearest-forward and lowest IV values below each smile method label", async () => {
    const payload = {
      ...seedPayload,
      sourceSnapshot: {
        ...seedPayload.sourceSnapshot,
        forward: 5190.2
      }
    } satisfies ExperimentalAnalytics;
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={payload} />);

    expect(markup).toContain('data-experimental-iv-method-value="custom_iv"');
    expect(markup).toContain('data-experimental-iv-method-value="spline_fit"');
    expect(markup).toContain('data-experimental-iv-method-low="custom_iv"');
    expect(markup).toContain('data-experimental-iv-method-low="spline_fit"');
    expect(markup).toContain("ATM 18.00%");
    expect(markup).toContain("Low 17.00% @ 5,200");
    expect(markup).toContain("ATM 18.10%");
    expect(markup).toContain("Low 17.10% @ 5,200");
  });

  it("renders a focused OTM midpoint versus spline IV chart", async () => {
    const payload = {
      ...seedPayload,
      ivSmiles: {
        ...seedPayload.ivSmiles,
        methods: [
          ...seedPayload.ivSmiles.methods,
          {
            key: "otm_midpoint_black76",
            label: "OTM midpoint Black-76",
            status: "ok" as const,
            points: [
              { x: 5190, y: 0.182 },
              { x: 5200, y: 0.172 },
              { x: 5210, y: 0.192 }
            ]
          },
          {
            key: "broker_iv",
            label: "Broker IV diagnostic",
            status: "preview" as const,
            points: [
              { x: 5190, y: 0.21 },
              { x: 5200, y: 0.2 },
              { x: 5210, y: 0.22 }
            ]
          }
        ]
      }
    } satisfies ExperimentalAnalytics;
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={payload} />);

    expect(markup).toContain('aria-label="OTM midpoint Black-76 vs spline fit"');
    expect(markup).toContain('data-experimental-focused-smile="true"');
    expect(markup).toContain('data-experimental-focused-series="otm_midpoint_black76"');
    expect(markup).toContain('data-experimental-focused-series="spline_fit"');
    expect(markup).not.toContain('data-experimental-focused-series="broker_iv"');
    expect(markup).not.toContain('data-experimental-focused-series="custom_iv"');
    expect(markup).toContain("Clean raw OTM IV against fitted total variance.");
  });

  it("shows experimental chart point values on mouse hover and keyboard focus", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const { container, root } = renderDashboard(<ExperimentalDashboard initialAnalytics={seedPayload} />);
    await act(async () => undefined);

    expect(container.querySelector("[data-experimental-chart-tooltip]")).toBeNull();

    const ivPoint = container.querySelector<SVGCircleElement>('[data-experimental-chart-point="custom_iv:5190"]');
    expect(ivPoint).not.toBeNull();
    await act(async () => {
      ivPoint?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const ivTooltip = container.querySelector<HTMLElement>('[data-experimental-chart-tooltip="iv_smile"]');
    expect(ivTooltip).not.toBeNull();
    expect(ivTooltip?.textContent).toContain("Current custom IV");
    expect(ivTooltip?.textContent).toContain("5,190");
    expect(ivTooltip?.textContent).toContain("18.00%");

    const distributionPoint = container.querySelector<SVGCircleElement>(
      '[data-experimental-chart-point="terminal_distribution:5200"]'
    );
    expect(distributionPoint).not.toBeNull();
    await act(async () => {
      distributionPoint?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    const distributionTooltip = container.querySelector<HTMLElement>(
      '[data-experimental-chart-tooltip="terminal_distribution"]'
    );
    expect(distributionTooltip).not.toBeNull();
    expect(distributionTooltip?.textContent).toContain("Terminal density");
    expect(distributionTooltip?.textContent).toContain("5,200");
    expect(distributionTooltip?.textContent).toContain("0.0400");

    cleanup(root, container);
  });

  it("toggles IV smile methods from the legend buttons", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const { container, root } = renderDashboard(<ExperimentalDashboard initialAnalytics={seedPayload} />);
    await act(async () => undefined);

    const customToggle = container.querySelector<HTMLButtonElement>(
      '[data-experimental-iv-method-toggle="custom_iv"]'
    );
    expect(customToggle).not.toBeNull();
    expect(customToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-experimental-series="custom_iv"]')).not.toBeNull();
    expect(container.querySelector('[data-experimental-chart-point="custom_iv:5190"]')).not.toBeNull();

    await act(async () => {
      customToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(customToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[data-experimental-series="custom_iv"]')).toBeNull();
    expect(container.querySelector('[data-experimental-chart-point="custom_iv:5190"]')).toBeNull();
    expect(container.querySelector('[data-experimental-series="spline_fit"]')).not.toBeNull();

    await act(async () => {
      customToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(customToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-experimental-series="custom_iv"]')).not.toBeNull();

    cleanup(root, container);
  });

  it("polls latest experimental analytics automatically after mount", async () => {
    const livePayload = {
      ...seedPayload,
      meta: {
        ...seedPayload.meta,
        generatedAt: "2026-04-29T17:00:00Z",
        sourceSessionId: "moomoo-spx-0dte-live",
        sourceSnapshotTime: "2026-04-29T17:00:00Z"
      },
      sourceSnapshot: {
        ...seedPayload.sourceSnapshot,
        spot: 7120.5,
        forward: 7120.4,
        rowCount: 122,
        strikeCount: 61
      }
    } satisfies ExperimentalAnalytics;
    mocks.loadClientExperimentalAnalytics.mockResolvedValue(livePayload);
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const { container, root } = renderDashboard(<ExperimentalDashboard initialAnalytics={seedPayload} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadClientExperimentalAnalytics).toHaveBeenCalled();
    expect(container.textContent).toContain("moomoo-spx-0dte-live");
    expect(container.textContent).toContain("122 rows / 61 strikes");

    cleanup(root, container);
  });

  it("preserves nullable chart gaps and renders single-point markers", async () => {
    const payload = {
      ...seedPayload,
      ivSmiles: {
        ...seedPayload.ivSmiles,
        methods: [
          {
            key: "custom_iv",
            label: "Current custom IV",
            status: "ok" as const,
            points: [
              { x: 5190, y: 0.18 },
              { x: 5200, y: null },
              { x: 5210, y: 0.19 }
            ]
          }
        ]
      },
      terminalDistribution: {
        ...seedPayload.terminalDistribution,
        density: [
          { x: 5190, y: 0.02 },
          { x: 5200, y: null },
          { x: 5210, y: 0.025 }
        ]
      }
    } satisfies ExperimentalAnalytics;
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={payload} />);

    expect(markup.match(/data-series-key="custom_iv"/g) ?? []).toHaveLength(2);
    expect(markup.match(/data-series-key="terminal_distribution"/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain('<polyline data-series-key="custom_iv"');
    expect(markup).not.toContain('<polyline data-series-key="terminal_distribution"');
    expect(markup).toContain("<circle");
  });

  it("renders diagnostics panels and all experimental tables semantically", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={seedPayload} />);

    expect(markup).toContain('aria-label="Smile diagnostics"');
    expect(markup).toContain("Spline valley");
    expect(markup).toContain("ATM forward IV");
    expect(markup).toContain('aria-label="Skew and tail asymmetry"');
    expect(markup).toContain("Left-tail rich");
    expect(markup).toContain('aria-label="Forward panel"');
    expect(markup).toContain("ATM strike");
    expect(markup).toContain("<caption>Risk-neutral probabilities</caption>");
    expect(markup).toContain("<caption>Move-needed map</caption>");
    expect(markup).toContain("<caption>Time-decay pressure</caption>");
    expect(markup).toContain("<caption>Rich/cheap residuals</caption>");
    expect(markup).toContain("<caption>Quote quality flags</caption>");
    expect(markup).toContain("<caption>Range compression preview</caption>");
    expect(markup).toContain("No history rows available.");
  });

  it("renders a useful unavailable state when analytics are null", async () => {
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialAnalytics={null} />);

    expect(markup).toContain("Experimental analytics unavailable");
    expect(markup).toContain("No experimental analytics payload is available.");
    expect(markup).toMatch(/<a[^>]*href="\/experimental"[^>]*aria-current="page"[^>]*>Experimental<\/a>/);
  });

  it("announces refresh failures from the unavailable state", async () => {
    mocks.loadClientExperimentalAnalytics.mockResolvedValue(null);
    const { ExperimentalDashboard } = await import("../components/ExperimentalDashboard");
    const { container, root } = renderDashboard(<ExperimentalDashboard initialAnalytics={null} />);
    await act(async () => undefined);

    const button = getButton(container, "Refresh");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Latest experimental analytics unavailable.");

    cleanup(root, container);
  });

  it("defines stable experimental chart and table layout styles", () => {
    expect(styles).toMatch(/\.experimentalKpiGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.experimentalChartFrame\s*{[\s\S]*min-height:\s*340px/);
    expect(styles).toMatch(/\.experimentalSeries\s*{[\s\S]*stroke-width:\s*1\.8/);
    expect(styles).toMatch(/\.experimentalLegend\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.experimentalTablesGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.experimentalTableWrap\s*{[\s\S]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.experimentalHeaderUtility \.statusRail span\s*{[\s\S]*white-space:\s*normal/);
  });
});

function renderDashboard(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}
