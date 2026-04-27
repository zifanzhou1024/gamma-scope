import React from "react";
import type { ReplaySession, ReplayTimelineEntry } from "../lib/clientReplaySource";
import {
  formatReplayMarketTime,
  jumpReplayTimelineIndex,
  REPLAY_PLAYBACK_SPEEDS
} from "../lib/replayPlayback";
import type { ReplayPlaybackSpeed } from "../lib/replayPlayback";

interface ArchiveTransportProps {
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

const JUMP_CONTROLS = [
  { label: "-1M", ariaLabel: "Jump back 1 minute", offsetMs: -60_000 },
  { label: "-5S", ariaLabel: "Jump back 5 seconds", offsetMs: -5_000 },
  { label: "-1S", ariaLabel: "Jump back 1 second", offsetMs: -1_000 },
  { label: "+1S", ariaLabel: "Jump forward 1 second", offsetMs: 1_000 },
  { label: "+5S", ariaLabel: "Jump forward 5 seconds", offsetMs: 5_000 },
  { label: "+1M", ariaLabel: "Jump forward 1 minute", offsetMs: 60_000 }
] as const;

export function ArchiveTransport({
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
}: ArchiveTransportProps) {
  const selectedSession = sessions.find((session) => session.session_id === selectedSessionId) ?? null;
  const hasTimelineEntries = timelineEntries.length > 0;
  const maxSnapshotIndex = Math.max(timelineEntries.length - 1, 0);
  const selectedPosition = hasTimelineEntries ? selectedSnapshotIndex + 1 : 0;
  const selectedSnapshotLabel = selectedTimelineEntry
    ? formatReplayMarketTime(selectedTimelineEntry.snapshot_time)
    : "No timestamp";
  const selectedSnapshotTitle = selectedTimelineEntry
    ? [
      selectedTimelineEntry.snapshot_time,
      selectedTimelineEntry.source_snapshot_id
    ].filter(Boolean).join(" | ")
    : undefined;
  const startLabel = timelineEntries[0] ? formatReplayMarketTime(timelineEntries[0].snapshot_time) : "Start";
  const endLabel = timelineEntries[maxSnapshotIndex] ? formatReplayMarketTime(timelineEntries[maxSnapshotIndex].snapshot_time) : "End";
  const loadedLabel = selectedSession
    ? `${selectedSession.expiry} / ${selectedSession.session_id}`
    : selectedSessionId ?? "No session";
  const statusMessage = errorMessage ?? (!isLoadingSessions && !hasSessions ? "No replay sessions available." : null);
  const isFrameControlDisabled = isLoadingSessions || isLoadingReplay || !hasTimelineEntries;
  const isTimelineDisabled = isFrameControlDisabled || timelineEntries.length <= 1;
  const isSessionSelectDisabled = isLoadingSessions || sessions.length === 0 || (isLoadingReplay && !isReplayStreamActive);
  const isActionDisabled = isLoadingReplay || isLoadingSessions || !hasSessions || !hasTimelineEntries;

  const selectFrame = (index: number) => {
    onSelectSnapshotIndex(Math.min(Math.max(index, 0), maxSnapshotIndex));
  };
  const jumpFrame = (offsetMs: number) => {
    selectFrame(jumpReplayTimelineIndex(timelineEntries, selectedSnapshotIndex, offsetMs));
  };

  return (
    <section className="archiveTransport" aria-label="Archive transport">
      <div className="archiveTransportHeader">
        <span className="eyebrow">ARCHIVE TRANSPORT</span>
        <strong>{isReplayStreamActive ? "Playing archive" : "Archive ready"}</strong>
      </div>

      <div className="archiveStatusStrip" aria-label="Archive status">
        <span><small>Loaded</small>{loadedLabel}</span>
        <span title={selectedSnapshotTitle}><small>Current ET</small>{selectedSnapshotLabel}</span>
        <span><small>Playback</small>{isReplayStreamActive ? "Playing" : "Paused"}</span>
        <span><small>Speed</small>{selectedPlaybackSpeed}x</span>
        <span><small>Frame</small>{selectedPosition} / {Math.max(timelineEntries.length, 1)}</span>
      </div>

      <div className="archiveTransportControls" aria-label="Archive playback controls">
        <button
          type="button"
          aria-label={JUMP_CONTROLS[0].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[0].offsetMs)}
        >
          -1M
        </button>
        <button
          type="button"
          aria-label={JUMP_CONTROLS[1].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[1].offsetMs)}
        >
          -5S
        </button>
        <button
          type="button"
          aria-label={JUMP_CONTROLS[2].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[2].offsetMs)}
        >
          -1S
        </button>
        <button
          type="button"
          aria-label="Previous frame"
          disabled={isFrameControlDisabled || selectedSnapshotIndex <= 0}
          onClick={() => selectFrame(selectedSnapshotIndex - 1)}
        >
          ←
        </button>
        {isReplayStreamActive ? (
          <button type="button" className="archivePrimaryButton" onClick={onStopReplayStream}>
            PAUSE
          </button>
        ) : (
          <button
            type="button"
            className="archivePrimaryButton"
            disabled={isActionDisabled}
            onClick={onPlayReplayStream}
          >
            PLAY
          </button>
        )}
        <button
          type="button"
          aria-label="Next frame"
          disabled={isFrameControlDisabled || selectedSnapshotIndex >= maxSnapshotIndex}
          onClick={() => selectFrame(selectedSnapshotIndex + 1)}
        >
          →
        </button>
        <button
          type="button"
          aria-label={JUMP_CONTROLS[3].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[3].offsetMs)}
        >
          +1S
        </button>
        <button
          type="button"
          aria-label={JUMP_CONTROLS[4].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[4].offsetMs)}
        >
          +5S
        </button>
        <button
          type="button"
          aria-label={JUMP_CONTROLS[5].ariaLabel}
          disabled={isFrameControlDisabled}
          onClick={() => jumpFrame(JUMP_CONTROLS[5].offsetMs)}
        >
          +1M
        </button>
      </div>

      <div className="archiveSpeedGroup" aria-label="Replay speed">
        {REPLAY_PLAYBACK_SPEEDS.map((speed) => (
          <button
            type="button"
            key={speed}
            aria-pressed={selectedPlaybackSpeed === speed}
            className={selectedPlaybackSpeed === speed ? "archiveSpeed-active" : undefined}
            disabled={isLoadingSessions || isLoadingReplay || !hasSessions || !hasTimelineEntries}
            onClick={() => onSelectPlaybackSpeed?.(speed)}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="archiveTimeline">
        <div className="archiveTimelineLabels">
          <span>{startLabel}</span>
          <strong>{selectedSnapshotLabel}</strong>
          <span>{endLabel}</span>
        </div>
        <input
          type="range"
          min="0"
          max={maxSnapshotIndex}
          step="1"
          value={selectedSnapshotIndex}
          disabled={isTimelineDisabled}
          aria-label="Replay timeline"
          onChange={(event) => selectFrame(Number(event.currentTarget.value))}
        />
      </div>

      <div className="archiveSessionTools">
        <label>
          <span>Replay session</span>
          <select
            value={selectedSessionId ?? ""}
            disabled={isSessionSelectDisabled}
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
        <button type="button" disabled={isActionDisabled} onClick={onLoadReplay}>
          {isLoadingReplay ? "LOADING" : "LOAD"}
        </button>
        <button
          type="button"
          className="secondaryButton"
          disabled={!isReplayModeActive && !isReplayStreamActive}
          onClick={onReturnToLive}
        >
          UNLOAD
        </button>
      </div>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
    </section>
  );
}
