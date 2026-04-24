import React from "react";

interface ReplayPanelProps {
  selectedSessionId: string | null;
  hasSessions: boolean;
  snapshotTimes: string[];
  selectedSnapshotIndex: number;
  selectedSnapshotTime: string | null;
  isReplayModeActive: boolean;
  isLoadingSessions: boolean;
  isLoadingReplay: boolean;
  errorMessage: string | null;
  onSelectSnapshotIndex: (index: number) => void;
  onLoadReplay: () => void;
  onReturnToLive: () => void;
}

export function ReplayPanel({
  selectedSessionId,
  hasSessions,
  snapshotTimes,
  selectedSnapshotIndex,
  selectedSnapshotTime,
  isReplayModeActive,
  isLoadingSessions,
  isLoadingReplay,
  errorMessage,
  onSelectSnapshotIndex,
  onLoadReplay,
  onReturnToLive
}: ReplayPanelProps) {
  const statusMessage = errorMessage ?? (!isLoadingSessions && !hasSessions ? "No replay sessions available." : null);
  const maxSnapshotIndex = Math.max(snapshotTimes.length - 1, 0);
  const isScrubberDisabled = isLoadingSessions || isLoadingReplay || snapshotTimes.length <= 1;
  const selectedPosition = snapshotTimes.length > 0 ? selectedSnapshotIndex + 1 : 0;

  return (
    <section className="replayPanel" aria-label="Replay controls">
      <div className="replayCopy">
        <span className="eyebrow">Replay</span>
        <strong>{selectedSessionId ?? "Seeded session"}</strong>
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
