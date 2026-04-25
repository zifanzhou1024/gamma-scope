import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { CollectorHealth } from "@gammascope/contracts/collector-events";

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title }: { title: string }) => <section>{title}</section>
}));

describe("DashboardView", () => {
  const snapshot = {
    ...seedSnapshot,
    mode: "live",
    session_id: "dashboard-view-session",
    spot: 5212.75
  } satisfies AnalyticsSnapshot;

  it("renders the dashboard snapshot details and option chain", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain("Live");
    expect(markup).toContain("dashboard-view-session");
    expect(markup).toContain("5,212.75");
    expect(markup).toContain("Option chain");
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
});
