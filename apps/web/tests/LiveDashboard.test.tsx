import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { ReplayImportResult } from "../lib/replayImportSource";
import * as LiveDashboardModule from "../components/LiveDashboard";

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title }: { title: string }) => <section>{title}</section>
}));

function replayImportResult(overrides: Partial<ReplayImportResult> = {}): ReplayImportResult {
  return {
    import_id: "import-ready",
    status: "awaiting_confirmation",
    summary: {},
    warnings: [],
    errors: [],
    session_id: null,
    replay_url: null,
    ...overrides
  };
}

function replaySession(overrides: {
  session_id: string;
  expiry?: string;
  start_time?: string;
  end_time?: string;
  snapshot_count?: number;
  timestamp_source?: "exact" | "estimated";
}) {
  return {
    session_id: overrides.session_id,
    symbol: "SPX",
    expiry: overrides.expiry ?? "2026-04-24",
    start_time: overrides.start_time ?? "2026-04-24T14:30:00Z",
    end_time: overrides.end_time ?? "2026-04-24T14:40:00Z",
    snapshot_count: overrides.snapshot_count ?? 3,
    timestamp_source: overrides.timestamp_source ?? "estimated" as const
  };
}

describe("LiveDashboard scenario panel", () => {
  it("renders the live dashboard without replay, import, or admin controls", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("SPX 0DTE analytics");
    expect(markup).toContain("Spot shift");
    expect(markup).toContain("Saved views");
    expect(markup).not.toContain("Replay session");
    expect(markup).not.toContain("Previous replay timestamp");
    expect(markup).not.toContain("Load replay");
    expect(markup).not.toContain("Admin");
    expect(markup).not.toContain("Username");
    expect(markup).not.toContain("Password");
    expect(markup).not.toContain("Replay import");
    expect(markup).not.toContain("Upload import");
  });

  it("ignores replay admin props on the live dashboard route", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(
      <LiveDashboardModule.LiveDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
      />
    );

    expect(markup).not.toContain("Replay session");
    expect(markup).not.toContain("Replay import");
    expect(markup).not.toContain("snapshots.parquet");
    expect(markup).not.toContain("quotes.parquet");
    expect(markup).not.toContain("Admin");
  });

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

  it("links to the replay workstation from the live dashboard", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<LiveDashboardModule.LiveDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("href=\"/replay\"");
    expect(markup).toContain("Replay workstation");
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

  it("includes exact source snapshot ids in replay snapshot requests", () => {
    expect(LiveDashboardModule.createReplaySnapshotRequest(
      "import-session",
      "2026-04-24T15:30:00.000Z",
      "snapshot-a"
    )).toEqual({
      session_id: "import-session",
      at: "2026-04-24T15:30:00.000Z",
      source_snapshot_id: "snapshot-a"
    });
  });

  it("creates exact single-frame load requests with the selected source snapshot id", () => {
    expect(LiveDashboardModule.createReplayLoadRequest("import-session", {
      index: 1,
      snapshot_time: "2026-04-24T15:30:00.000Z",
      source_snapshot_id: "snapshot-a"
    })).toEqual({
      session_id: "import-session",
      at: "2026-04-24T15:30:00.000Z",
      source_snapshot_id: "snapshot-a"
    });
  });

  it("creates replay stream requests from exact selections with the selected source snapshot id", () => {
    expect(LiveDashboardModule.createReplayStreamRequest("import-session", {
      index: 1,
      snapshot_time: "2026-04-24T15:30:00.000Z",
      source_snapshot_id: "snapshot-a"
    })).toEqual({
      sessionId: "import-session",
      at: "2026-04-24T15:30:00.000Z",
      sourceSnapshotId: "snapshot-a"
    });
  });

  it("loads exact timestamp entries only for exact replay sessions", () => {
    expect(LiveDashboardModule.shouldLoadExactReplayTimestamps(replaySession({
      session_id: "import-session",
      timestamp_source: "exact"
    }))).toBe(true);
    expect(LiveDashboardModule.shouldLoadExactReplayTimestamps(replaySession({
      session_id: "seed-session",
      timestamp_source: "estimated"
    }))).toBe(false);
    expect(LiveDashboardModule.shouldLoadExactReplayTimestamps(null)).toBe(false);
  });

  it("uses exact imported entries for dashboard replay timelines", () => {
    const session = replaySession({
      session_id: "import-session",
      timestamp_source: "exact",
      snapshot_count: 2
    });

    expect(LiveDashboardModule.createDashboardReplayTimelineEntries(session, {
      session_id: "import-session",
      timestamp_source: "exact",
      timestamps: [
        {
          index: 0,
          snapshot_time: "2026-04-24T14:30:00Z",
          source_snapshot_id: "snapshot-a"
        },
        {
          index: 1,
          snapshot_time: "2026-04-24T14:30:00Z",
          source_snapshot_id: "snapshot-b"
        }
      ]
    })).toEqual([
      {
        index: 0,
        snapshot_time: "2026-04-24T14:30:00Z",
        source_snapshot_id: "snapshot-a"
      },
      {
        index: 1,
        snapshot_time: "2026-04-24T14:30:00Z",
        source_snapshot_id: "snapshot-b"
      }
    ]);
  });

  it("does not fall back to estimated timeline entries for exact sessions without exact timestamps", () => {
    expect(LiveDashboardModule.createDashboardReplayTimelineEntries(replaySession({
      session_id: "import-session",
      timestamp_source: "exact",
      start_time: "2026-04-24T14:30:00Z",
      end_time: "2026-04-24T14:40:00Z",
      snapshot_count: 3
    }), null)).toEqual([]);

    expect(LiveDashboardModule.createDashboardReplayTimelineEntries(replaySession({
      session_id: "import-session",
      timestamp_source: "exact",
      start_time: "2026-04-24T14:30:00Z",
      end_time: "2026-04-24T14:40:00Z",
      snapshot_count: 3
    }), {
      session_id: "import-session",
      timestamp_source: "exact",
      timestamps: []
    })).toEqual([]);
  });

  it("uses estimated fallback entries when exact timestamps are unavailable", () => {
    expect(LiveDashboardModule.createDashboardReplayTimelineEntries(replaySession({
      session_id: "seed-session",
      timestamp_source: "estimated",
      start_time: "2026-04-24T14:30:00Z",
      end_time: "2026-04-24T14:40:00Z",
      snapshot_count: 3
    }), null)).toEqual([
      {
        index: 0,
        snapshot_time: "2026-04-24T14:30:00.000Z"
      },
      {
        index: 1,
        snapshot_time: "2026-04-24T14:35:00.000Z"
      },
      {
        index: 2,
        snapshot_time: "2026-04-24T14:40:00.000Z"
      }
    ]);
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

  it("creates replay playback start state with replay mode active to suppress live polling", () => {
    expect(LiveDashboardModule.createReplayStreamStartState).toBeTypeOf("function");

    expect(LiveDashboardModule.createReplayStreamStartState()).toEqual({
      scenarioRequestsCanceled: true,
      replayRequestsCanceled: false,
      isApplyingScenario: false,
      isLoadingReplay: false,
      replayError: null,
      isReplayStreamActive: true,
      isReplayModeActive: true
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

  it("invalidates in-flight replay responses before replay selection changes or advances", () => {
    expect(LiveDashboardModule.createReplaySelectionChangeState).toBeTypeOf("function");

    const selectionChangeState = LiveDashboardModule.createReplaySelectionChangeState(4);

    expect(selectionChangeState).toEqual({
      latestReplayRequestId: 5,
      replayRequestsCanceled: true,
      isReplayStreamActive: false,
      isLoadingReplay: false
    });
    expect(LiveDashboardModule.canApplyReplaySnapshot({
      responseRequestId: 4,
      latestRequestId: selectionChangeState.latestReplayRequestId,
      replayRequestsCanceled: selectionChangeState.replayRequestsCanceled
    })).toBe(false);
  });

  it("advances client replay playback from timeline entries while preserving source ids by index", () => {
    expect(LiveDashboardModule.nextDashboardReplayPlaybackIndex).toBeTypeOf("function");

    const entries = [
      {
        index: 0,
        snapshot_time: "2026-04-22T13:30:00.000Z",
        source_snapshot_id: "snapshot-a"
      },
      {
        index: 1,
        snapshot_time: "2026-04-22T13:30:00.000Z",
        source_snapshot_id: "snapshot-b"
      },
      {
        index: 2,
        snapshot_time: "2026-04-22T13:30:05.000Z",
        source_snapshot_id: "snapshot-c"
      }
    ];

    const nextIndex = LiveDashboardModule.nextDashboardReplayPlaybackIndex(entries, 0, 5);

    expect(nextIndex).toBe(1);
    expect(entries[nextIndex]?.source_snapshot_id).toBe("snapshot-b");
  });

  it("derives authenticated and logged-out admin dashboard states", () => {
    expect(LiveDashboardModule.createDashboardAdminStateFromSessionPayload({
      authenticated: true,
      csrf_token: "csrf-token"
    }, true)).toEqual({
      isAdminAuthenticated: true,
      isAdminAvailable: true,
      adminCsrfToken: "csrf-token",
      adminErrorMessage: null
    });

    expect(LiveDashboardModule.createDashboardAdminStateFromSessionPayload({
      authenticated: false,
      csrf_token: null
    }, true)).toEqual({
      isAdminAuthenticated: false,
      isAdminAvailable: true,
      adminCsrfToken: null,
      adminErrorMessage: null
    });

    const loggedOutState = LiveDashboardModule.createLoggedOutAdminState();
    expect(loggedOutState).toEqual({
      isAdminAuthenticated: false,
      isAdminAvailable: true,
      adminCsrfToken: null,
      adminErrorMessage: null
    });
    expect(LiveDashboardModule.shouldShowReplayImportControls(loggedOutState.isAdminAuthenticated)).toBe(false);
  });

  it("blocks stale admin session probe results after a newer admin transition", () => {
    expect(LiveDashboardModule.canApplyDashboardAsyncResult({
      responseRequestId: 1,
      latestRequestId: 2,
      isCanceled: false
    })).toBe(false);
    expect(LiveDashboardModule.canApplyDashboardAsyncResult({
      responseRequestId: 2,
      latestRequestId: 2,
      isCanceled: false
    })).toBe(true);
    expect(LiveDashboardModule.canApplyDashboardAsyncResult({
      responseRequestId: 2,
      latestRequestId: 2,
      isCanceled: true
    })).toBe(false);
  });

  it("blocks stale replay session loads after a newer import refresh selection", () => {
    const initialReplayLoadRequestId = 1;
    const importRefreshRequestId = 2;

    expect(LiveDashboardModule.canApplyDashboardAsyncResult({
      responseRequestId: initialReplayLoadRequestId,
      latestRequestId: importRefreshRequestId,
      isCanceled: false
    })).toBe(false);
    expect(LiveDashboardModule.canApplyDashboardAsyncResult({
      responseRequestId: importRefreshRequestId,
      latestRequestId: importRefreshRequestId,
      isCanceled: false
    })).toBe(true);
  });

  it("selects the completed imported replay session after refresh at the first timestamp", () => {
    const importResult = replayImportResult({
      status: "completed",
      session_id: "import-session-ready",
      replay_url: "/replay?session_id=import-session-ready"
    });

    expect(LiveDashboardModule.selectReplaySessionAfterImportConfirm(importResult, [
      replaySession({
        session_id: "seed-spx-2026-04-23",
        expiry: "2026-04-23",
        start_time: "2026-04-23T14:30:00Z",
        end_time: "2026-04-23T14:35:00Z",
        snapshot_count: 2
      }),
      replaySession({
        session_id: "import-session-ready",
        snapshot_count: 3
      })
    ])).toEqual({
      selectedReplaySessionId: "import-session-ready",
      selectedReplayIndex: 0
    });
  });

  it("confirms import through the dashboard action, refreshes sessions, and selects the completed import", async () => {
    const completedImport = replayImportResult({
      status: "completed",
      session_id: "import-session-ready",
      replay_url: "/replay?session_id=import-session-ready"
    });
    const refreshedSessions = [
      replaySession({ session_id: "seed-spx-2026-04-23", snapshot_count: 2 }),
      replaySession({ session_id: "import-session-ready", snapshot_count: 3 })
    ];
    const confirmImport = vi.fn(async () => completedImport);
    const loadReplaySessions = vi.fn(async () => refreshedSessions);

    const result = await LiveDashboardModule.confirmReplayImportDashboardAction({
      importId: "import-ready",
      csrfToken: "csrf-token",
      confirmImport,
      loadReplaySessions
    });

    expect(confirmImport).toHaveBeenCalledWith("import-ready", "csrf-token");
    expect(loadReplaySessions).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      result: completedImport,
      replaySessions: refreshedSessions,
      selection: {
        selectedReplaySessionId: "import-session-ready",
        selectedReplayIndex: 0
      },
      errorMessage: null
    });
  });

  it("clears unpublished import review after cancel", () => {
    const cancelledImport = replayImportResult({
      status: "cancelled",
      session_id: null
    });

    expect(LiveDashboardModule.shouldClearReplayImportAfterCancel(cancelledImport, "import-ready")).toBe(true);
    expect(LiveDashboardModule.shouldClearReplayImportAfterCancel(cancelledImport, "other-import")).toBe(false);
  });

  it("cancels import through the dashboard action and marks the review for clearing", async () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;
    const pendingImport = replayImportResult({ status: "awaiting_confirmation" });
    const cancelledImport = replayImportResult({
      status: "cancelled",
      session_id: null
    });
    const cancelImport = vi.fn(async () => cancelledImport);

    const beforeMarkup = renderToStaticMarkup(
      <LiveDashboardModule.LiveDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
        initialReplayImport={pendingImport}
      />
    );
    const result = await LiveDashboardModule.cancelReplayImportDashboardAction({
      importId: "import-ready",
      currentImportId: "import-ready",
      csrfToken: "csrf-token",
      cancelImport
    });
    const afterMarkup = renderToStaticMarkup(
      <LiveDashboardModule.LiveDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
        initialReplayImport={result.shouldClearCurrentImport ? null : result.result}
      />
    );

    expect(cancelImport).toHaveBeenCalledWith("import-ready", "csrf-token");
    expect(result).toEqual({
      result: cancelledImport,
      shouldClearCurrentImport: true,
      errorMessage: null
    });
    expect(beforeMarkup).not.toContain("import-ready");
    expect(beforeMarkup).not.toContain("Confirm import");
    expect(afterMarkup).not.toContain("Replay import");
    expect(afterMarkup).not.toContain("import-ready");
    expect(afterMarkup).not.toContain("Confirm import");
  });

  it("logs out through the dashboard action and returns state that hides import controls", async () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "live-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ authenticated: false })));

    const beforeMarkup = renderToStaticMarkup(
      <LiveDashboardModule.LiveDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
        initialReplayImport={replayImportResult({ status: "awaiting_confirmation" })}
      />
    );
    const result = await LiveDashboardModule.logoutAdminDashboardAction({
      csrfToken: "csrf-token",
      fetcher
    });
    const afterMarkup = renderToStaticMarkup(
      <LiveDashboardModule.LiveDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: result.adminState.isAdminAuthenticated,
          csrfToken: result.adminState.adminCsrfToken,
          isAvailable: result.adminState.isAdminAvailable
        }}
        initialReplayImport={result.currentReplayImport}
      />
    );

    expect(fetcher).toHaveBeenCalledWith("/api/admin/logout", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-CSRF": "csrf-token"
      }
    });
    expect(result).toEqual({
      adminState: {
        isAdminAuthenticated: false,
        isAdminAvailable: true,
        adminCsrfToken: null,
        adminErrorMessage: null
      },
      currentReplayImport: null,
      replayImportError: null,
      isUploadingReplayImport: false,
      isConfirmingReplayImport: false
    });
    expect(beforeMarkup).not.toContain("Replay import");
    expect(beforeMarkup).not.toContain("import-ready");
    expect(afterMarkup).not.toContain("Replay import");
    expect(afterMarkup).not.toContain("import-ready");
    expect(LiveDashboardModule.shouldShowReplayImportControls(result.adminState.isAdminAuthenticated)).toBe(false);
  });
});
