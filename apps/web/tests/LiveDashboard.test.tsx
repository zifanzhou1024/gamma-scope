import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import * as LiveDashboardModule from "../components/LiveDashboard";

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title }: { title: string }) => <section>{title}</section>
}));

describe("LiveDashboard scenario panel", () => {
  it("renders compact scenario controls with the live dashboard", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("Spot shift");
    expect(markup).toContain("Vol shift");
    expect(markup).toContain("Time shift");
    expect(markup).toContain("Apply scenario");
  });

  it("creates a scenario request from the current snapshot and control values", () => {
    expect(LiveDashboardModule.createScenarioRequest).toBeTypeOf("function");

    const request = LiveDashboardModule.createScenarioRequest(seedSnapshot, {
      spotShift: "12.5",
      volShift: "-1.25",
      timeShift: "15"
    });

    expect(request).toEqual({
      session_id: seedSnapshot.session_id,
      snapshot_time: seedSnapshot.snapshot_time,
      spot_shift_points: 12.5,
      vol_shift_points: -1.25,
      time_shift_minutes: 15
    });
  });

  it("disables live polling while scenario mode is active", () => {
    expect(LiveDashboardModule.shouldPollLiveSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.shouldPollLiveSnapshot(false)).toBe(true);
    expect(LiveDashboardModule.shouldPollLiveSnapshot(true)).toBe(false);
  });

  it("only applies the latest live refresh while scenario mode is inactive", () => {
    expect(LiveDashboardModule.canApplyLiveSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.canApplyLiveSnapshot({
      isScenarioModeActive: false,
      responseRequestId: 3,
      latestRequestId: 3
    })).toBe(true);
    expect(LiveDashboardModule.canApplyLiveSnapshot({
      isScenarioModeActive: true,
      responseRequestId: 3,
      latestRequestId: 3
    })).toBe(false);
    expect(LiveDashboardModule.canApplyLiveSnapshot({
      isScenarioModeActive: false,
      responseRequestId: 2,
      latestRequestId: 3
    })).toBe(false);
  });

  it("only applies the latest active scenario response", () => {
    expect(LiveDashboardModule.canApplyScenarioSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.canApplyScenarioSnapshot({
      responseRequestId: 4,
      latestRequestId: 4,
      scenarioRequestsCanceled: false
    })).toBe(true);
    expect(LiveDashboardModule.canApplyScenarioSnapshot({
      responseRequestId: 3,
      latestRequestId: 4,
      scenarioRequestsCanceled: false
    })).toBe(false);
    expect(LiveDashboardModule.canApplyScenarioSnapshot({
      responseRequestId: 4,
      latestRequestId: 4,
      scenarioRequestsCanceled: true
    })).toBe(false);
  });
});
