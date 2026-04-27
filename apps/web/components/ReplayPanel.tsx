import React from "react";
import type { ReplaySession, ReplayTimelineEntry } from "../lib/clientReplaySource";
import {
  formatReplayMarketTime,
  isReplayPlaybackSpeed,
  REPLAY_PLAYBACK_SPEEDS
} from "../lib/replayPlayback";
import type { ReplayPlaybackSpeed } from "../lib/replayPlayback";

interface ReplayPanelProps {
  selectedSessionId: string | null;
  sessions: ReplaySession[];
  hasSessions: boolean;
  timelineEntries: ReplayTimelineEntry[];
  selectedSnapshotIndex: number;
  selectedTimelineEntry: ReplayTimelineEntry | null;
  selectedPlaybackSpeed?: ReplayPlaybackSpeed;
  isReplayModeActive: boolean;
  isReplayStreamActive: boolean;
  isLoadingSessions: boolean;
  isLoadingReplay: boolean;
  errorMessage: string | null;
  onSelectSessionId: (sessionId: string) => void;
  onSelectSnapshotIndex: (index: number) => void;
  onSelectPlaybackSpeed?: (speed: ReplayPlaybackSpeed) => void;
  onLoadReplay: () => void;
  onPlayReplayStream: () => void;
  onStopReplayStream: () => void;
  onReturnToLive: () => void;
}

export function ReplayPanel({
  selectedSessionId,
  sessions,
  hasSessions,
  timelineEntries,
  selectedSnapshotIndex,
  selectedTimelineEntry,
  selectedPlaybackSpeed = 1,
  isReplayModeActive,
  isReplayStreamActive,
  isLoadingSessions,
  isLoadingReplay,
  errorMessage,
  onSelectSessionId,
  onSelectSnapshotIndex,
  onSelectPlaybackSpeed,
  onLoadReplay,
  onPlayReplayStream,
  onStopReplayStream,
  onReturnToLive
}: ReplayPanelProps) {
  const statusMessage = errorMessage ?? (!isLoadingSessions && !hasSessions ? "No replay sessions available." : null);
  const hasTimelineEntries = timelineEntries.length > 0;
  const maxSnapshotIndex = Math.max(timelineEntries.length - 1, 0);
  const isScrubberDisabled = isLoadingSessions || isLoadingReplay || isReplayStreamActive || timelineEntries.length <= 1;
  const selectedPosition = timelineEntries.length > 0 ? selectedSnapshotIndex + 1 : 0;
  const selectedSnapshotLabel = selectedTimelineEntry
    ? formatReplayMarketTime(selectedTimelineEntry.snapshot_time)
    : "No timestamp";
  const selectedSnapshotTitle = selectedTimelineEntry
    ? [
      selectedTimelineEntry.snapshot_time,
      selectedTimelineEntry.source_snapshot_id
    ].filter(Boolean).join(" | ")
    : undefined;

  return (
    <section className="replayPanel" aria-label="Replay controls">
      <div className="replayCopy">
        <span className="eyebrow">Replay</span>
        <label>
          <span>Replay session</span>
          <select
            value={selectedSessionId ?? ""}
            disabled={isLoadingSessions || sessions.length === 0 || (isLoadingReplay && !isReplayStreamActive)}
            onChange={(event) => {
              onSelectSessionId(event.currentTarget.value);
            }}
          >
            {sessions.length > 0 ? sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.session_id}
              </option>
            )) : (
              <option value="">Seeded session</option>
            )}
          </select>
        </label>
        <label>
          <span>Replay speed</span>
          <select
            value={selectedPlaybackSpeed}
            disabled={isLoadingSessions || isLoadingReplay || isReplayStreamActive || !hasSessions || !hasTimelineEntries}
            onChange={(event) => {
              const speed = Number(event.currentTarget.value);

              if (isReplayPlaybackSpeed(speed)) {
                onSelectPlaybackSpeed?.(speed);
              }
            }}
          >
            {REPLAY_PLAYBACK_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}x
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="replayTimeline">
        <div className="replayTimelineMeta">
          <span title={selectedSnapshotTitle}>
            {selectedSnapshotLabel}
          </span>
          <strong>{selectedPosition} / {Math.max(timelineEntries.length, 1)}</strong>
        </div>
        <div className="replayTimelineControls">
          <button
            type="button"
            className="replayStepButton"
            aria-label="Previous replay timestamp"
            disabled={isScrubberDisabled || selectedSnapshotIndex <= 0}
            onClick={() => {
              onSelectSnapshotIndex(Math.max(selectedSnapshotIndex - 1, 0));
            }}
          >
            Prev
          </button>
          <input
            type="range"
            min="0"
            max={maxSnapshotIndex}
            step="1"
            value={selectedSnapshotIndex}
            disabled={isScrubberDisabled}
            aria-label="Replay timestamp"
            onChange={(event) => {
              onSelectSnapshotIndex(Number(event.currentTarget.value));
            }}
          />
          <button
            type="button"
            className="replayStepButton"
            aria-label="Next replay timestamp"
            disabled={isScrubberDisabled || selectedSnapshotIndex >= maxSnapshotIndex}
            onClick={() => {
              onSelectSnapshotIndex(Math.min(selectedSnapshotIndex + 1, maxSnapshotIndex));
            }}
          >
            Next
          </button>
        </div>
      </div>
      <div className="replayActions">
        {isReplayStreamActive ? (
          <button type="button" className="secondaryButton" onClick={onStopReplayStream}>
            Stop replay
          </button>
        ) : (
          <button
            type="button"
            onClick={onPlayReplayStream}
            disabled={isLoadingReplay || isLoadingSessions || !hasSessions || !hasTimelineEntries}
          >
            Play replay
          </button>
        )}
        <button
          type="button"
          onClick={onLoadReplay}
          disabled={isLoadingReplay || isLoadingSessions || !hasSessions || !hasTimelineEntries}
        >
          {isLoadingReplay ? "Loading replay" : "Load replay"}
        </button>
        {isReplayModeActive ? (
          <button type="button" className="secondaryButton" onClick={onReturnToLive}>
            Return to live
          </button>
        ) : null}
      </div>
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
    </section>
  );
}
