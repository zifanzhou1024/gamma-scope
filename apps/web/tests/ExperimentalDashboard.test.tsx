import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;
const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

describe("ExperimentalDashboard", () => {
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
    expect(markup).toContain("Current custom IV");
    expect(markup).toContain("Spline fit");
    expect(markup).toContain("data-series-key=\"custom_iv\"");
    expect(markup).toContain("data-series-key=\"spline_fit\"");
    expect(markup).toContain('aria-label="Terminal distribution chart"');
    expect(markup).toContain("Highest density");
    expect(markup).toContain("5195-5205");
    expect(markup).toContain("68% range");
    expect(markup).toContain("95% range");
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

  it("defines stable experimental chart and table layout styles", () => {
    expect(styles).toMatch(/\.experimentalKpiGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.experimentalChartFrame\s*{[\s\S]*min-height:\s*260px/);
    expect(styles).toMatch(/\.experimentalTablesGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.experimentalTableWrap\s*{[\s\S]*overflow-x:\s*auto/);
  });
});
