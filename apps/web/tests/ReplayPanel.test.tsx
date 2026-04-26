import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReplayPanel } from "../components/ReplayPanel";

describe("ReplayPanel", () => {
  it("renders replay session choices", () => {
    const onSelectSessionId = vi.fn();

    const markup = renderToStaticMarkup(
      <ReplayPanel
        selectedSessionId="captured-session"
        sessions={[
          {
            session_id: "captured-session",
            symbol: "SPX",
            expiry: "2026-04-27",
            start_time: "2026-04-27T14:30:00Z",
            end_time: "2026-04-27T14:35:00Z",
            snapshot_count: 2
          },
          {
            session_id: "seed-spx-2026-04-23",
            symbol: "SPX",
            expiry: "2026-04-23",
            start_time: "2026-04-23T15:30:00Z",
            end_time: "2026-04-23T16:00:00Z",
            snapshot_count: 4
          }
        ]}
        hasSessions
        snapshotTimes={["2026-04-27T14:30:00.000Z", "2026-04-27T14:35:00.000Z"]}
        selectedSnapshotIndex={1}
        selectedSnapshotTime="2026-04-27T14:35:00.000Z"
        isReplayModeActive={false}
        isReplayStreamActive={false}
        isLoadingSessions={false}
        isLoadingReplay={false}
        errorMessage={null}
        onSelectSessionId={onSelectSessionId}
        onSelectSnapshotIndex={vi.fn()}
        onLoadReplay={vi.fn()}
        onPlayReplayStream={vi.fn()}
        onStopReplayStream={vi.fn()}
        onReturnToLive={vi.fn()}
      />
    );

    expect(markup).toContain("Replay session");
    expect(markup).toContain("captured-session");
    expect(markup).toContain("seed-spx-2026-04-23");
  });

  it("renders play and stop controls for replay streaming", () => {
    const baseProps = {
      selectedSessionId: "captured-session",
      sessions: [{
        session_id: "captured-session",
        symbol: "SPX",
        expiry: "2026-04-27",
        start_time: "2026-04-27T14:30:00Z",
        end_time: "2026-04-27T14:35:00Z",
        snapshot_count: 2
      }],
      hasSessions: true,
      snapshotTimes: ["2026-04-27T14:30:00.000Z", "2026-04-27T14:35:00.000Z"],
      selectedSnapshotIndex: 0,
      selectedSnapshotTime: "2026-04-27T14:30:00.000Z",
      isReplayModeActive: false,
      isLoadingSessions: false,
      isLoadingReplay: false,
      errorMessage: null,
      onSelectSessionId: vi.fn(),
      onSelectSnapshotIndex: vi.fn(),
      onLoadReplay: vi.fn(),
      onPlayReplayStream: vi.fn(),
      onStopReplayStream: vi.fn(),
      onReturnToLive: vi.fn()
    };

    const idleMarkup = renderToStaticMarkup(
      <ReplayPanel {...baseProps} isReplayStreamActive={false} />
    );
    const playingMarkup = renderToStaticMarkup(
      <ReplayPanel {...baseProps} isReplayStreamActive />
    );

    expect(idleMarkup).toContain("Play replay");
    expect(playingMarkup).toContain("Stop replay");
  });
});
