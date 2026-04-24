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

  it("can render a calls-only chain while keeping the strike spine visible", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} initialChainSide="calls" />);

    expect(markup).toContain("Call mid");
    expect(markup).not.toContain("Put mid");
    expect(markup).toContain("Strike");
    expect(markup).toContain("5,200.00");
  });

  it("can render a puts-only chain while keeping the strike spine visible", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} initialChainSide="puts" />);

    expect(markup).not.toContain("Call mid");
    expect(markup).toContain("Put mid");
    expect(markup).toContain("Strike");
    expect(markup).toContain("5,200.00");
  });
});
