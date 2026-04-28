// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { ReplaySession, ReplayTimelineEntry } from "../lib/clientReplaySource";
import type { ReplayImportResult } from "../lib/replayImportSource";
import { DATA_SOURCE_STORAGE_KEY } from "../lib/sourcePreference";
import * as ReplayDashboardModule from "../components/ReplayDashboard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function replaySession(sessionId: string): ReplaySession {
  return {
    session_id: sessionId,
    symbol: "SPX",
    expiry: "2026-04-24",
    start_time: "2026-04-24T14:30:00Z",
    end_time: "2026-04-24T14:40:00Z",
    snapshot_count: 3,
    timestamp_source: "estimated"
  };
}

describe("ReplayDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders replay dashboard with shared navigation, archive transport, and import review controls", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "replay-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(
      <ReplayDashboardModule.ReplayDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
        initialReplayImport={replayImportResult()}
      />
    );

    expect(markup).toContain("ARCHIVE TRANSPORT");
    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Realtime<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/replay"[^>]*aria-current="page"[^>]*>Replay<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/heatmap"[^>]*>Heatmap<\/a>/);
    expect(markup).not.toMatch(/<a[^>]*href="\/heatmap"[^>]*aria-current="page"[^>]*>Heatmap<\/a>/);
    expect(markup).toContain("Replay session");
    expect(markup).not.toContain("Previous replay timestamp");
    expect(markup).toContain("LOAD");
    expect(markup).toMatch(/class="adminUtility"[\s\S]*Authenticated[\s\S]*Log out/);
    expect(markup).toContain("Replay import");
    expect(markup).toContain("snapshots.parquet");
    expect(markup).toContain("quotes.parquet");
    expect(markup).toContain("Confirm import");
    expect(markup).toContain("href=\"/\"");
  });

  it("defaults the replay dashboard source selector to Moomoo", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "replay-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<ReplayDashboardModule.ReplayDashboard initialSnapshot={snapshot} />);

    expect(markup).toContain("Data source");
    expect(markup).toContain("Moomoo");
    expect(markup).toMatch(/option[^>]*value="moomoo"[^>]*selected=""/);
  });

  it("renders the theme switch on the replay dashboard header", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "replay-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(<ReplayDashboardModule.ReplayDashboard initialSnapshot={snapshot} />);

    const topBarStart = markup.indexOf("class=\"topBar\"");
    const themeToggleIndex = markup.indexOf("data-theme-toggle");
    const adminUtilityIndex = markup.indexOf("class=\"adminUtility\"");

    expect(topBarStart).toBeGreaterThanOrEqual(0);
    expect(themeToggleIndex).toBeGreaterThan(topBarStart);
    expect(themeToggleIndex).toBeLessThan(adminUtilityIndex);
    expect(markup).toContain("Theme");
    expect(markup).toContain("Dark");
  });

  it("loads persisted source preference on the replay dashboard", async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, "ibkr");
    const snapshot = {
      ...seedSnapshot,
      session_id: "replay-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const { container, root } = renderReplayDashboard(
      <ReplayDashboardModule.ReplayDashboard initialSnapshot={snapshot} />
    );

    await act(async () => undefined);

    const selector = container.querySelector<HTMLSelectElement>("select[aria-label=\"Data source\"]");
    expect(selector?.value).toBe("ibkr");
    expect(container.textContent).toContain("Preferred IBKR");

    cleanupRenderedReplayDashboard(root, container);
  });

  it("keeps admin utility outside the replay control grid while import remains with replay tools", () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "replay-dashboard-session",
      snapshot_time: "2026-04-24T16:15:00Z"
    } satisfies AnalyticsSnapshot;

    const markup = renderToStaticMarkup(
      <ReplayDashboardModule.ReplayDashboard
        initialSnapshot={snapshot}
        initialAdminSession={{
          authenticated: true,
          csrfToken: "csrf-token",
          isAvailable: true
        }}
        initialReplayImport={replayImportResult()}
      />
    );

    const topBarStart = markup.indexOf("class=\"topBar\"");
    const adminUtilityIndex = markup.indexOf("class=\"adminUtility\"");
    const controlsStart = markup.indexOf("class=\"dashboardControls\"");
    const controlsEnd = markup.indexOf("class=\"kpiGrid\"");
    const controlsMarkup = markup.slice(controlsStart, controlsEnd);

    expect(topBarStart).toBeGreaterThanOrEqual(0);
    expect(adminUtilityIndex).toBeGreaterThan(topBarStart);
    expect(adminUtilityIndex).toBeLessThan(controlsStart);
    expect(controlsMarkup).toContain("class=\"archiveTransport\"");
    expect(controlsMarkup).toContain("class=\"replayImportPanel\"");
    expect(controlsMarkup).not.toContain("class=\"adminPanel\"");
    expect(controlsMarkup).not.toContain("class=\"adminUtility\"");
    expect(controlsMarkup.indexOf("class=\"archiveTransport\"")).toBeLessThan(
      controlsMarkup.indexOf("class=\"replayImportPanel\"")
    );
  });

  it("invalidates stale replay loads before applying a manual frame selection", () => {
    const entries: ReplayTimelineEntry[] = [
      {
        index: 0,
        snapshot_time: "2026-04-24T14:30:00.000Z",
        source_snapshot_id: "snapshot-a"
      },
      {
        index: 1,
        snapshot_time: "2026-04-24T14:31:00.000Z",
        source_snapshot_id: "snapshot-b"
      },
      {
        index: 2,
        snapshot_time: "2026-04-24T14:32:00.000Z",
        source_snapshot_id: "snapshot-c"
      }
    ];

    expect(ReplayDashboardModule.createManualReplayFrameSelectionState(4, 2, entries)).toEqual({
      latestReplayRequestId: 5,
      replayRequestsCanceled: true,
      isReplayStreamActive: false,
      isLoadingReplay: false,
      selectedReplayIndex: 2
    });
    expect(ReplayDashboardModule.createManualReplayFrameSelectionState(4, 99, entries).selectedReplayIndex).toBe(2);
  });

  it("starts replay streams from the first frame when already positioned on the final frame", () => {
    const entries: ReplayTimelineEntry[] = [
      {
        index: 0,
        snapshot_time: "2026-04-24T14:30:00.000Z",
        source_snapshot_id: "snapshot-a"
      },
      {
        index: 1,
        snapshot_time: "2026-04-24T14:31:00.000Z",
        source_snapshot_id: "snapshot-b"
      },
      {
        index: 2,
        snapshot_time: "2026-04-24T14:32:00.000Z",
        source_snapshot_id: "snapshot-c"
      }
    ];

    expect(ReplayDashboardModule.createReplayStreamStartingIndex(2, entries)).toBe(0);
    expect(ReplayDashboardModule.createReplayStreamStartingIndex(1, entries)).toBe(1);
  });

  it("prefers the requested replay session when loaded sessions include it", () => {
    const sessions = [
      replaySession("first-session"),
      replaySession("import-session-ready")
    ];

    expect(ReplayDashboardModule.selectInitialReplaySessionId(sessions, "import-session-ready")).toBe("import-session-ready");
    expect(ReplayDashboardModule.selectInitialReplaySessionId(sessions, "missing-session")).toBe("first-session");
    expect(ReplayDashboardModule.selectInitialReplaySessionId(sessions, null)).toBe("first-session");
    expect(ReplayDashboardModule.selectInitialReplaySessionId([], "import-session-ready")).toBeNull();
  });
});

function renderReplayDashboard(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function cleanupRenderedReplayDashboard(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
