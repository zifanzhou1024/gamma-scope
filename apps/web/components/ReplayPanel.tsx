import React from "react";

interface ReplayPanelProps {
  selectedSessionId: string | null;
  hasSessions: boolean;
  isReplayModeActive: boolean;
  isLoadingSessions: boolean;
  isLoadingReplay: boolean;
  errorMessage: string | null;
  onLoadReplay: () => void;
  onReturnToLive: () => void;
}

export function ReplayPanel({
  selectedSessionId,
  hasSessions,
  isReplayModeActive,
  isLoadingSessions,
  isLoadingReplay,
  errorMessage,
  onLoadReplay,
  onReturnToLive
}: ReplayPanelProps) {
  const statusMessage = errorMessage ?? (!isLoadingSessions && !hasSessions ? "No replay sessions available." : null);

  return (
    <section className="replayPanel" aria-label="Replay controls">
      <div className="replayCopy">
        <span className="eyebrow">Replay</span>
        <strong>{selectedSessionId ?? "Seeded session"}</strong>
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
