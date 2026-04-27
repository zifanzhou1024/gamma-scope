import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArchiveTransport } from "../components/ArchiveTransport";

describe("ArchiveTransport", () => {
  it("renders archive status, timeline, speeds, and transport controls", () => {
    const markup = renderToStaticMarkup(
      <ArchiveTransport
        selectedSessionId="captured-session"
        sessions={[{
          session_id: "captured-session",
          symbol: "SPX",
          expiry: "2026-04-22",
          start_time: "2026-04-22T13:30:02Z",
          end_time: "2026-04-22T13:31:02Z",
          snapshot_count: 3,
          timestamp_source: "exact"
        }]}
        hasSessions
        timelineEntries={[
          {
            index: 0,
            snapshot_time: "2026-04-22T13:30:02Z",
            source_snapshot_id: "snapshot-a"
          },
          {
            index: 1,
            snapshot_time: "2026-04-22T13:30:07Z",
            source_snapshot_id: "snapshot-b"
          },
          {
            index: 2,
            snapshot_time: "2026-04-22T13:31:02Z",
            source_snapshot_id: "snapshot-c"
          }
        ]}
        selectedSnapshotIndex={1}
        selectedTimelineEntry={{
          index: 1,
          snapshot_time: "2026-04-22T13:30:07Z",
          source_snapshot_id: "snapshot-b"
        }}
        selectedPlaybackSpeed={30}
        isReplayModeActive
        isReplayStreamActive={false}
        isLoadingSessions={false}
        isLoadingReplay={false}
        errorMessage={null}
        onSelectSessionId={vi.fn()}
        onSelectSnapshotIndex={vi.fn()}
        onSelectPlaybackSpeed={vi.fn()}
        onLoadReplay={vi.fn()}
        onPlayReplayStream={vi.fn()}
        onStopReplayStream={vi.fn()}
        onReturnToLive={vi.fn()}
      />
    );

    expect(markup).toContain("ARCHIVE TRANSPORT");
    expect(markup).toContain("captured-session");
    expect(markup).toContain("04/22/2026");
    expect(markup).toContain("09:30:07");
    expect(markup).toContain("EDT");
    expect(markup).toContain("Loaded");
    expect(markup).toContain("30x");
    expect(markup).toContain("2 / 3");
    expect(markup).toContain("09:30:02");
    expect(markup).toContain("09:31:02");
    expect(markup).toContain("aria-label=\"Replay timeline\"");

    for (const label of ["-1M", "-5S", "-1S", "←", "PLAY", "→", "+1S", "+5S", "+1M"]) {
      expect(markup).toContain(label);
    }

    for (const label of [
      "Jump back 1 minute",
      "Jump back 5 seconds",
      "Jump back 1 second",
      "Jump forward 1 second",
      "Jump forward 5 seconds",
      "Jump forward 1 minute"
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }

    for (const speed of ["1x", "5x", "10x", "30x", "60x"]) {
      expect(markup).toContain(speed);
    }

    expect(markup).toContain("Replay session");
    expect(markup).toContain("LOAD");
    expect(markup).toContain("UNLOAD");
  });
});
