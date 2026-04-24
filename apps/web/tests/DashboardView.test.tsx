import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title }: { title: string }) => <section>{title}</section>
}));

describe("DashboardView", () => {
  it("renders the dashboard snapshot details and option chain", async () => {
    const snapshot = {
      ...seedSnapshot,
      mode: "live",
      session_id: "dashboard-view-session",
      spot: 5212.75
    } satisfies AnalyticsSnapshot;

    const { DashboardView } = await import("../components/DashboardView");
    const markup = renderToStaticMarkup(<DashboardView snapshot={snapshot} />);

    expect(markup).toContain("Live");
    expect(markup).toContain("dashboard-view-session");
    expect(markup).toContain("5,212.75");
    expect(markup).toContain("Option chain");
  });
});
