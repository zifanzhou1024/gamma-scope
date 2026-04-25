import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";

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
