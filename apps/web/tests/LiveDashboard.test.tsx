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

  it("renders compact replay controls with the live dashboard", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("Replay");
    expect(markup).toContain("Previous replay timestamp");
    expect(markup).toContain("Next replay timestamp");
    expect(markup).toContain("Load replay");
  });

  it("renders saved view controls with the live dashboard", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("Saved views");
    expect(markup).toContain("View name");
    expect(markup).toContain("Save current view");
  });

  it("creates a saved view draft from the current snapshot", () => {
    expect(LiveDashboardModule.createSavedViewDraft).toBeTypeOf("function");

    expect(LiveDashboardModule.createSavedViewDraft(seedSnapshot, {
      name: "Default replay view",
      viewId: "view-from-dashboard",
      createdAt: "2026-04-24T17:00:00Z"
    })).toEqual({
      view_id: "view-from-dashboard",
      owner_scope: "public_demo",
      name: "Default replay view",
      mode: seedSnapshot.mode,
      strike_window: {
        levels_each_side: 20
      },
      visible_charts: ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
      created_at: "2026-04-24T17:00:00Z"
    });
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

  it("disables live polling while replay mode is active", () => {
    expect(LiveDashboardModule.shouldPollLiveSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.shouldPollLiveSnapshot(false, false)).toBe(true);
    expect(LiveDashboardModule.shouldPollLiveSnapshot(false, true)).toBe(false);
  });

  it("disables live polling while replay stream is active before replay mode starts", () => {
    expect(LiveDashboardModule.shouldPollLiveSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.shouldPollLiveSnapshot(false, false, true)).toBe(false);
  });

  it("refreshes collector health while live polling is active", () => {
    expect(LiveDashboardModule.shouldPollCollectorHealth).toBeTypeOf("function");

    expect(LiveDashboardModule.shouldPollCollectorHealth(false, false)).toBe(true);
    expect(LiveDashboardModule.shouldPollCollectorHealth(true, false)).toBe(false);
    expect(LiveDashboardModule.shouldPollCollectorHealth(false, true)).toBe(false);
    expect(LiveDashboardModule.shouldPollCollectorHealth(false, false, true)).toBe(false);
  });

  it("creates a replay snapshot request from a selected replay session", () => {
    expect(LiveDashboardModule.createReplaySnapshotRequest).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplaySnapshotRequest("seeded-replay-session")).toEqual({
      session_id: "seeded-replay-session"
    });
  });

  it("includes the selected replay timestamp in replay snapshot requests", () => {
    expect(LiveDashboardModule.createReplaySnapshotRequest("seeded-replay-session", "2026-04-24T15:30:00.000Z")).toEqual({
      session_id: "seeded-replay-session",
      at: "2026-04-24T15:30:00.000Z"
    });
  });

  it("clears scenario loading state when replay starts", () => {
    expect(LiveDashboardModule.createReplayStartState).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplayStartState()).toEqual({
      scenarioRequestsCanceled: true,
      replayRequestsCanceled: false,
      isApplyingScenario: false,
      isLoadingReplay: true,
      replayError: null
    });
  });

  it("creates replay stream start state without activating replay mode before the first snapshot", () => {
    expect(LiveDashboardModule.createReplayStreamStartState).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplayStreamStartState()).toEqual({
      scenarioRequestsCanceled: true,
      replayRequestsCanceled: true,
      isApplyingScenario: false,
      isLoadingReplay: false,
      replayError: null,
      isReplayStreamActive: true,
      isReplayModeActive: false
    });
  });

  it("keeps replay mode inactive when replay stream fails before a snapshot arrives", () => {
    expect(LiveDashboardModule.createReplayStreamUnavailableState).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplayStreamUnavailableState(false)).toEqual({
      isReplayStreamActive: false,
      isReplayModeActive: false,
      replayError: "Replay stream unavailable."
    });
  });

  it("keeps replay mode active when replay stream fails after applying a snapshot", () => {
    expect(LiveDashboardModule.createReplayStreamUnavailableState).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplayStreamUnavailableState(true)).toEqual({
      isReplayStreamActive: false,
      isReplayModeActive: true,
      replayError: "Replay stream unavailable."
    });
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

    const replayStreamPendingState = {
      isScenarioModeActive: false,
      isReplayModeActive: false,
      isReplayStreamActive: true,
      responseRequestId: 3,
      latestRequestId: 3
    };
    expect(LiveDashboardModule.canApplyLiveSnapshot(replayStreamPendingState)).toBe(false);
  });

  it("allows recovered stream snapshots while a fallback poll is still in flight", () => {
    expect(LiveDashboardModule.canApplyLiveStreamSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.canApplyLiveStreamSnapshot({
      isScenarioModeActive: false,
      isReplayModeActive: false
    })).toBe(true);
    expect(LiveDashboardModule.canApplyLiveStreamSnapshot({
      isScenarioModeActive: true,
      isReplayModeActive: false
    })).toBe(false);
    expect(LiveDashboardModule.canApplyLiveStreamSnapshot({
      isScenarioModeActive: false,
      isReplayModeActive: true
    })).toBe(false);

    const replayStreamPendingState = {
      isScenarioModeActive: false,
      isReplayModeActive: false,
      isReplayStreamActive: true
    };
    expect(LiveDashboardModule.canApplyLiveStreamSnapshot(replayStreamPendingState)).toBe(false);
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

  it("allows an intentional scenario response from replay while blocking stale responses canceled by replay", () => {
    expect(LiveDashboardModule.canApplyScenarioSnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.canApplyScenarioSnapshot({
      responseRequestId: 5,
      latestRequestId: 5,
      scenarioRequestsCanceled: false,
      isReplayModeActive: true
    })).toBe(true);
    expect(LiveDashboardModule.canApplyScenarioSnapshot({
      responseRequestId: 5,
      latestRequestId: 5,
      scenarioRequestsCanceled: true,
      isReplayModeActive: true
    })).toBe(false);
  });

  it("only applies the latest active replay response", () => {
    expect(LiveDashboardModule.canApplyReplaySnapshot).toBeTypeOf("function");

    expect(LiveDashboardModule.canApplyReplaySnapshot({
      responseRequestId: 4,
      latestRequestId: 4,
      replayRequestsCanceled: false
    })).toBe(true);
    expect(LiveDashboardModule.canApplyReplaySnapshot({
      responseRequestId: 3,
      latestRequestId: 4,
      replayRequestsCanceled: false
    })).toBe(false);
    expect(LiveDashboardModule.canApplyReplaySnapshot({
      responseRequestId: 4,
      latestRequestId: 4,
      replayRequestsCanceled: true
    })).toBe(false);
  });
});
