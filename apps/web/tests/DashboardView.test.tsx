import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { CollectorHealth } from "@gammascope/contracts/collector-events";

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({
    title,
    spot,
    forward,
    atmValue,
    showZeroLine,
    inspectedStrike,
    inspection,
    sharedStrikeDomain,
    onInspectStrike,
    onClearInspection
  }: {
    title: string;
    spot?: number | null;
    forward?: number | null;
    atmValue?: number | null;
    showZeroLine?: boolean;
    inspectedStrike?: number | null;
    inspection?: { strike: number } | null;
    sharedStrikeDomain?: [number, number] | null;
    onInspectStrike?: (strike: number) => void;
    onClearInspection?: () => void;
  }) => (
    <section
      data-chart-title={title}
      data-chart-spot={spot ?? ""}
      data-chart-forward={forward ?? ""}
      data-chart-atm-value={atmValue ?? ""}
      data-chart-zero-line={showZeroLine ? "true" : "false"}
      data-chart-inspected-strike={inspectedStrike ?? ""}
      data-chart-inspection-strike={inspection?.strike ?? ""}
      data-chart-shared-strike-domain={sharedStrikeDomain?.join(":") ?? ""}
      data-chart-can-inspect={typeof onInspectStrike === "function" ? "true" : "false"}
      data-chart-can-clear={typeof onClearInspection === "function" ? "true" : "false"}
    >
      {title}
    </section>
  )
}));

const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

describe("DashboardView", () => {
  const snapshot = {
    ...seedSnapshot,
    mode: "live",
    session_id: "dashboard-view-session",
    spot: 5201.25,
    forward: 5202.1
  } satisfies AnalyticsSnapshot;

  it("renders the dashboard snapshot details and option chain", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain("Live");
    expect(markup).toContain("dashboard-view-session");
    expect(markup).toContain("5,201.25");
    expect(markup).toContain("Option chain");
  });

  it("renders market map levels and expanded exposure metrics", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain("MARKET MAP");
    expect(markup).toContain('data-market-map-level="spot"');
    expect(markup).toContain('data-market-map-level="forward"');
    expect(markup).toContain(">Spot<");
    expect(markup).toContain(">Forward<");
    expect(markup).toContain("ATM strike");
    expect(markup).toContain("Call IV low");
    expect(markup).toContain("Put IV low");
    expect(markup).toContain("Gamma peak");
    expect(markup).toContain("Vanna flip");
    expect(markup).toContain("Vanna max");
    expect(markup).toContain("Net gamma");
    expect(markup).toContain("Abs gamma");
    expect(markup).toContain("Net vanna");
    expect(markup).toContain("Abs vanna");
  });

  it("renders a compact market intelligence panel with ranges, walls, and regimes", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const intelligenceSnapshot = {
      ...snapshot,
      spot: 5200,
      expiry: "2026-04-23",
      snapshot_time: "2026-04-23T18:00:00Z",
      rows: [
        { ...snapshot.rows[0]!, strike: 5180, right: "call" as const, custom_iv: 0.24, custom_gamma: -0.2, custom_vanna: 0.01 },
        { ...snapshot.rows[1]!, strike: 5180, right: "put" as const, custom_iv: 0.23, custom_gamma: -0.15, custom_vanna: 0.02 },
        { ...snapshot.rows[2]!, strike: 5200, right: "call" as const, custom_iv: 0.2, custom_gamma: 0.1, custom_vanna: -0.3 },
        { ...snapshot.rows[3]!, strike: 5200, right: "put" as const, custom_iv: 0.2, custom_gamma: 0.1, custom_vanna: -0.2 },
        { ...snapshot.rows[4]!, strike: 5220, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.3, custom_vanna: 0.05 },
        { ...snapshot.rows[5]!, strike: 5220, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.2, custom_vanna: 0.04 }
      ]
    } satisfies AnalyticsSnapshot;
    const markup = renderToStaticMarkup(<DashboardView snapshot={intelligenceSnapshot} />);

    expect(markup).toContain('aria-label="Market intelligence"');
    expect(markup).toContain("MARKET INTELLIGENCE");
    expect(markup).toContain("0.5σ range");
    expect(markup).toContain("1σ range");
    expect(markup).toContain("Positive gamma wall");
    expect(markup).toContain("5,220.00");
    expect(markup).toContain("Negative gamma wall");
    expect(markup).toContain("5,180.00");
    expect(markup).toContain("Vanna wall");
    expect(markup).toContain("Gamma regime");
    expect(markup).toContain("Pinning");
    expect(markup).toContain("Vanna regime");
    expect(markup).toContain("Suppressive");
    expect(markup).toContain("IV smile bias");
    expect(markup).toContain("Left-skew");
  });

  it("renders level movement labels with a waiting state for the first snapshot", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} activeDashboard="replay" />);

    expect(markup).toContain('aria-label="Level movement"');
    expect(markup).toContain("LEVEL MOVEMENT");
    expect(markup).toContain("Waiting for next snapshot");
    expect(markup).toContain("Spot");
    expect(markup).toContain("Call IV low");
    expect(markup).toContain("Put IV low");
    expect(markup).toContain("Gamma peak");
    expect(markup).toContain("Vanna flip");
  });

  it("marks vanna fallback levels as nearest zero instead of a true flip", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const oneSidedVannaSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row, index) => ({
        ...row,
        custom_vanna: 0.001 + index * 0.0001
      }))
    } satisfies AnalyticsSnapshot;
    const markup = renderToStaticMarkup(<DashboardView snapshot={oneSidedVannaSnapshot} />);

    expect(markup).toContain('data-market-map-level="vanna-flip"');
    expect(markup).toContain("Vanna nearest zero");
  });

  it("passes spot forward ATM values and vanna zero line flag to charts", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain('data-chart-spot="5201.25"');
    expect(markup).toContain('data-chart-forward="5202.1"');
    expect(markup).toContain('data-chart-title="IV BY STRIKE"');
    expect(markup).toContain('data-chart-title="GAMMA BY STRIKE"');
    expect(markup).toContain('data-chart-title="VANNA BY STRIKE"');
    expect(markup).toContain('data-chart-zero-line="true"');
  });

  it("passes default shared inspection props and handlers to all charts", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup.match(/data-chart-can-inspect="true"/g) ?? []).toHaveLength(3);
    expect(markup.match(/data-chart-can-clear="true"/g) ?? []).toHaveLength(3);
    expect(markup.match(/data-chart-inspected-strike=""/g) ?? []).toHaveLength(3);
    expect(markup.match(/data-chart-inspection-strike=""/g) ?? []).toHaveLength(3);
  });

  it("passes the same shared strike domain to all dashboard charts", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const domainSnapshot = {
      ...snapshot,
      rows: [
        { ...snapshot.rows[0], strike: 5180, custom_iv: 0.22, custom_gamma: null, custom_vanna: null },
        { ...snapshot.rows[1], strike: 5190, custom_iv: null, custom_gamma: 0.004, custom_vanna: null },
        { ...snapshot.rows[2], strike: 5220, custom_iv: null, custom_gamma: null, custom_vanna: 0.001 }
      ]
    } satisfies AnalyticsSnapshot;
    const markup = renderToStaticMarkup(<DashboardView snapshot={domainSnapshot} />);

    expect(markup.match(/data-chart-shared-strike-domain="5180:5220"/g) ?? []).toHaveLength(3);
  });

  it("renders option-chain filters as pressed-state buttons with All selected by default", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup.match(/<button/g) ?? []).toHaveLength(3);
    expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*All<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>.*Calls<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>.*Puts<\/button>/);
  });

  it("renders IBKR comparison context for IV and gamma in the default chain", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain("IBKR 17.95%");
    expect(markup).toContain("-15.0 bp");
    expect(markup).toContain("IBKR 0.01986");
    expect(markup).toContain("+0.00030");
    expect(markup).toContain("IBKR 17.70%");
    expect(markup).toContain("+10.0 bp");
    expect(markup).toContain("IBKR 0.02041");
    expect(markup).toContain("-0.00024");
  });

  it("renders compact status chips when IBKR comparison context is missing or stale", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const comparisonSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row) =>
        row.strike === 5200 && row.right === "call"
          ? {
              ...row,
              ibkr_iv: null,
              ibkr_gamma: null,
              iv_diff: null,
              gamma_diff: null,
              comparison_status: "stale" as const
            }
          : row
      )
    } satisfies AnalyticsSnapshot;
    const markup = renderToStaticMarkup(<DashboardView snapshot={comparisonSnapshot} />);

    expect(markup).toContain("Stale");
  });

  it("renders compact collector health context near the status area", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const collectorHealth = {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-dev",
      status: "degraded",
      ibkr_account_mode: "paper",
      message: "IBKR market data delayed",
      event_time: "2026-04-24T15:00:00Z",
      received_time: "2026-04-24T15:00:01Z"
    } satisfies CollectorHealth;
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} collectorHealth={collectorHealth} />);

    expect(markup).toContain("Collector");
    expect(markup).toContain("Degraded");
    expect(markup).toContain("IBKR Paper");
    expect(markup).toContain("IBKR market data delayed");
  });

  it("renders transport status, operational notices, and row issue chips", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const degradedSnapshot = {
      ...snapshot,
      source_status: "degraded",
      coverage_status: "partial",
      rows: snapshot.rows.map((row, index) => {
        if (index === 0) {
          return { ...row, bid: 14.25, ask: 14, calc_status: "stale_underlying" as const };
        }
        return row;
      })
    } satisfies AnalyticsSnapshot;
    const collectorHealth = {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-dev",
      status: "disconnected",
      ibkr_account_mode: "paper",
      message: "Collector socket disconnected",
      event_time: "2026-04-24T15:00:00Z",
      received_time: "2026-04-24T15:00:01Z"
    } satisfies CollectorHealth;
    const markup = renderToStaticMarkup(
      <DashboardView
        snapshot={degradedSnapshot}
        collectorHealth={collectorHealth}
        transportStatus="fallback_polling"
      />
    );

    expect(markup).toContain("Transport Fallback polling");
    expect(markup).toContain("Partial chain");
    expect(markup).toContain("Source degraded");
    expect(markup).toContain("Collector disconnected");
    expect(markup).toContain("Crossed quotes");
    expect(markup).toContain("Calculation issues");
    expect(markup).toContain("Stale underlying");
    expect(markup).toContain("Crossed quote");
  });

  it("renders a compact data quality panel with realtime trust details", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const degradedSnapshot = {
      ...snapshot,
      mode: "live",
      snapshot_time: "2026-04-23T20:30:00Z",
      expiry: "2026-04-23",
      source_status: "stale",
      coverage_status: "partial",
      freshness_ms: 18_500,
      rows: [
        { ...snapshot.rows[0]!, strike: 5200, bid: 12, ask: 12.5, calc_status: "ok" as const },
        { ...snapshot.rows[1]!, strike: 5200, bid: 13, ask: 12.5, calc_status: "solver_failed" as const },
        { ...snapshot.rows[2]!, strike: 5210, bid: null, ask: 3.25, calc_status: "missing_quote" as const },
        { ...snapshot.rows[3]!, strike: 5220, bid: 2.25, ask: null, calc_status: "ok" as const }
      ]
    } satisfies AnalyticsSnapshot;
    const collectorHealth = {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-dev",
      status: "degraded",
      ibkr_account_mode: "paper",
      message: "IBKR market data delayed",
      event_time: "2026-04-24T15:00:00Z",
      received_time: "2026-04-24T15:00:01Z"
    } satisfies CollectorHealth;
    const markup = renderToStaticMarkup(
      <DashboardView
        snapshot={degradedSnapshot}
        collectorHealth={collectorHealth}
        transportStatus="fallback_polling"
        activeDashboard="realtime"
      />
    );

    expect(markup).toContain('aria-label="Data quality"');
    expect(markup).toContain("04:30:00 PM EDT");
    expect(markup).toContain("2026-04-23");
    expect(markup).toContain("0DTE");
    expect(markup).toContain("4 rows");
    expect(markup).toContain("3 strikes");
    expect(markup).toContain("18.5s stale");
    expect(markup).toContain("Source stale");
    expect(markup).toContain("Partial chain");
    expect(markup).toContain("Transport Fallback polling");
    expect(markup).toContain("Collector Degraded");
    expect(markup).toContain("IBKR Paper");
    expect(markup).toContain("Valid 1");
    expect(markup).toContain("Crossed 1");
    expect(markup).toContain("Missing bid/ask 2");
    expect(markup).toContain("Calc issues 2");
    expect(markup).toContain("Live mode");
    expect(markup).toContain("Realtime dashboard");
  });

  it("renders disconnected transport and both row chips when quote and calc issues coexist", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const degradedSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row, index) =>
        index === 0 ? { ...row, bid: 14.25, ask: 14, calc_status: "stale_underlying" as const } : row
      )
    } satisfies AnalyticsSnapshot;
    const markup = renderToStaticMarkup(<DashboardView snapshot={degradedSnapshot} transportStatus="disconnected" />);

    expect(markup).toContain("Transport Disconnected");
    expect(markup).toContain("WebSocket stream disconnected.");
    expect(markup).toContain("Crossed quote");
    expect(markup).toContain("Stale underlying");
  });

  it("can render a calls-only chain while keeping the strike spine visible", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} initialChainSide="calls" />);

    expect(markup).toContain("Call mid");
    expect(markup).not.toContain("Put mid");
    expect(markup).toContain("Strike");
    expect(markup).toContain("5,200.00");
    expect(markup).toContain("IBKR 17.95%");
    expect(markup).toContain("-15.0 bp");
    expect(markup).not.toContain("IBKR 17.70%");
    expect(markup).not.toContain("+10.0 bp");
  });

  it("can render a puts-only chain while keeping the strike spine visible", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} initialChainSide="puts" />);

    expect(markup).not.toContain("Call mid");
    expect(markup).toContain("Put mid");
    expect(markup).toContain("Strike");
    expect(markup).toContain("5,200.00");
    expect(markup).not.toContain("IBKR 17.95%");
    expect(markup).not.toContain("-15.0 bp");
    expect(markup).toContain("IBKR 17.70%");
    expect(markup).toContain("+10.0 bp");
  });

  it("uses green for call columns and red for put columns in option-chain styling", async () => {
    expect(styles).toMatch(/\.chainTable \.callCol\s*{[\s\S]*color:\s*var\(--call-color\)/);
    expect(styles).toMatch(/\.chainTable \.putCol\s*{[\s\S]*color:\s*var\(--put-color\)/);
    expect(styles).toMatch(/\.callRisk \.heatFill\s*{[\s\S]*var\(--call-color-rgb\)/);
    expect(styles).toMatch(/\.putRisk \.heatFill\s*{[\s\S]*var\(--put-color-rgb\)/);
    expect(styles).toMatch(/\.callInterest \.oiBar\s*{[\s\S]*var\(--call-color-rgb\)/);
    expect(styles).toMatch(/\.putInterest \.oiBar\s*{[\s\S]*var\(--put-color-rgb\)/);
  });

  it("defines shared inspection bar styles that contain table overflow", async () => {
    expect(styles).toMatch(/\.sharedInspectionBar\s*{[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/\.sharedInspectionStrike\s*{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.sharedInspectionTableWrap\s*{[\s\S]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.sharedInspectionTable\s*{[\s\S]*border-collapse:\s*collapse/);
    expect(styles).toMatch(/\.sharedInspectionClear\s*{[\s\S]*white-space:\s*nowrap/);
  });

  it("defines compact wrapping styles for the data quality panel", async () => {
    expect(styles).toMatch(/\.dataQualityPanel\s*{[\s\S]*display:\s*grid/);
    expect(styles).toMatch(/\.dataQualityGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
    expect(styles).toMatch(/\.dataQualityItem\s*{[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/\.dataQualityValue\s*{[\s\S]*overflow-wrap:\s*anywhere/);
  });

  it("defines compact wrapping styles for the market intelligence panel", async () => {
    expect(styles).toMatch(/\.marketIntelligencePanel\s*{[\s\S]*padding:\s*16px 0/);
    expect(styles).toMatch(/\.marketIntelligenceGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
    expect(styles).toMatch(/\.marketIntelligenceItem\s*{[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/\.marketIntelligenceItem strong\s*{[\s\S]*overflow-wrap:\s*anywhere/);
  });

  it("defines compact wrapping styles for the level movement panel", async () => {
    expect(styles).toMatch(/\.levelMovementPanel\s*{[\s\S]*padding:\s*16px 0/);
    expect(styles).toMatch(/\.levelMovementGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
    expect(styles).toMatch(/\.levelMovementItem\s*{[\s\S]*min-width:\s*0/);
    expect(styles).toMatch(/\.levelMovementValue\s*{[\s\S]*overflow-wrap:\s*anywhere/);
  });
});
