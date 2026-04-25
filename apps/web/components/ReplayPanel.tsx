import React from "react";
import type { ReplaySession } from "../lib/clientReplaySource";

interface ReplayPanelProps {
  selectedSessionId: string | null;
  sessions: ReplaySession[];
  hasSessions: boolean;
  snapshotTimes: string[];
  selectedSnapshotIndex: number;
  selectedSnapshotTime: string | null;
  isReplayModeActive: boolean;
  isReplayStreamActive: boolean;
  isLoadingSessions: boolean;
  isLoadingReplay: boolean;
  errorMessage: string | null;
  onSelectSessionId: (sessionId: string) => void;
  onSelectSnapshotIndex: (index: number) => void;
  onLoadReplay: () => void;
  onPlayReplayStream: () => void;
  onStopReplayStream: () => void;
  onReturnToLive: () => void;
}

export function ReplayPanel({
  selectedSessionId,
  sessions,
  hasSessions,
  snapshotTimes,
  selectedSnapshotIndex,
  selectedSnapshotTime,
  isReplayModeActive,
  isReplayStreamActive,
  isLoadingSessions,
  isLoadingReplay,
  errorMessage,
  onSelectSessionId,
  onSelectSnapshotIndex,
  onLoadReplay,
  onPlayReplayStream,
  onStopReplayStream,
  onReturnToLive
}: ReplayPanelProps) {
  const statusMessage = errorMessage ?? (!isLoadingSessions && !hasSessions ? "No replay sessions available." : null);
  const maxSnapshotIndex = Math.max(snapshotTimes.length - 1, 0);
  const isScrubberDisabled = isLoadingSessions || isLoadingReplay || isReplayStreamActive || snapshotTimes.length <= 1;
  const selectedPosition = snapshotTimes.length > 0 ? selectedSnapshotIndex + 1 : 0;

  return (
    <section className="replayPanel" aria-label="Replay controls">
      <div className="replayCopy">
        <span className="eyebrow">Replay</span>
        <label>
          <span>Replay session</span>
          <select
            value={selectedSessionId ?? ""}
            disabled={isLoadingSessions || isLoadingReplay || isReplayStreamActive || sessions.length === 0}
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
      </div>
      <div className="replayTimeline">
        <div className="replayTimelineMeta">
          <span>{selectedSnapshotTime ?? "No timestamp"}</span>
          <strong>{selectedPosition} / {Math.max(snapshotTimes.length, 1)}</strong>
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
            disabled={isLoadingReplay || isLoadingSessions || !hasSessions}
          >
            Play replay
          </button>
        )}
        <button type="button" onClick={onLoadReplay} disabled={isLoadingReplay || isLoadingSessions || !hasSessions}>
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
