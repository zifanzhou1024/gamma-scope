"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { SavedView } from "../lib/clientSavedViewsSource";
import {
  createSavedViewDraft as buildSavedViewDraft,
  loadClientSavedViews,
  saveClientSavedView
} from "../lib/clientSavedViewsSource";
import { loadClientDashboardSnapshot } from "../lib/clientSnapshotSource";
import type { CollectorHealth } from "../lib/clientCollectorStatusSource";
import { loadClientCollectorHealth } from "../lib/clientCollectorStatusSource";
import type { LiveTransportStatus } from "../lib/dashboardMetrics";
import type { ScenarioRequest } from "../lib/clientScenarioSource";
import { requestClientScenarioSnapshot } from "../lib/clientScenarioSource";
import type { ReplaySnapshotRequest, ReplaySession } from "../lib/clientReplaySource";
import {
  clampReplayIndex,
  loadClientReplaySessions,
  loadClientReplaySnapshot,
  replayTimestampOptions
} from "../lib/clientReplaySource";
import { startSnapshotPolling } from "../lib/snapshotPolling";
import { startReplayStream } from "../lib/replayStream";
import { startLiveSnapshotUpdates } from "../lib/snapshotUpdates";
import type { LiveSnapshotUpdateSource } from "../lib/snapshotUpdates";
import { DashboardView } from "./DashboardView";
import { ReplayPanel } from "./ReplayPanel";
import { SavedViewsPanel } from "./SavedViewsPanel";
import { ScenarioPanel } from "./ScenarioPanel";

export { createSavedViewDraft } from "../lib/clientSavedViewsSource";

interface LiveDashboardProps {
  initialSnapshot: AnalyticsSnapshot;
}

interface ScenarioControlValues {
  spotShift: string;
  volShift: string;
  timeShift: string;
}

interface LiveSnapshotApplyState {
  isScenarioModeActive: boolean;
  isReplayModeActive?: boolean;
  isReplayStreamActive?: boolean;
  responseRequestId: number;
  latestRequestId: number;
}

interface LiveStreamSnapshotApplyState {
  isScenarioModeActive: boolean;
  isReplayModeActive?: boolean;
  isReplayStreamActive?: boolean;
}

interface ScenarioSnapshotApplyState {
  responseRequestId: number;
  latestRequestId: number;
  scenarioRequestsCanceled: boolean;
  isReplayModeActive?: boolean;
}

interface ReplaySnapshotApplyState {
  responseRequestId: number;
  latestRequestId: number;
  replayRequestsCanceled: boolean;
}

interface ReplayStartState {
  scenarioRequestsCanceled: boolean;
  replayRequestsCanceled: boolean;
  isApplyingScenario: boolean;
  isLoadingReplay: boolean;
  replayError: string | null;
}

interface ReplayStreamStartState {
  scenarioRequestsCanceled: boolean;
  replayRequestsCanceled: boolean;
  isApplyingScenario: boolean;
  isLoadingReplay: boolean;
  replayError: string | null;
  isReplayStreamActive: boolean;
  isReplayModeActive: boolean;
}

interface ReplayStreamUnavailableState {
  isReplayStreamActive: boolean;
  isReplayModeActive: boolean;
  replayError: string;
}

export function createScenarioRequest(
  snapshot: AnalyticsSnapshot,
  controlValues: ScenarioControlValues
): ScenarioRequest {
  return {
    session_id: snapshot.session_id,
    snapshot_time: snapshot.snapshot_time,
    spot_shift_points: Number(controlValues.spotShift || 0),
    vol_shift_points: Number(controlValues.volShift || 0),
    time_shift_minutes: Number(controlValues.timeShift || 0)
  };
}

export function createReplaySnapshotRequest(
  selectedSessionId: string | null,
  selectedReplayTime?: string | null
): ReplaySnapshotRequest | null {
  if (!selectedSessionId) {
    return null;
  }

  return selectedReplayTime ? { session_id: selectedSessionId, at: selectedReplayTime } : { session_id: selectedSessionId };
}

export function createReplayStartState(): ReplayStartState {
  return {
    scenarioRequestsCanceled: true,
    replayRequestsCanceled: false,
    isApplyingScenario: false,
    isLoadingReplay: true,
    replayError: null
  };
}

export function createReplayStreamStartState(): ReplayStreamStartState {
  return {
    scenarioRequestsCanceled: true,
    replayRequestsCanceled: true,
    isApplyingScenario: false,
    isLoadingReplay: false,
    replayError: null,
    isReplayStreamActive: true,
    isReplayModeActive: false
  };
}

export function createReplayStreamUnavailableState(hasReceivedSnapshot: boolean): ReplayStreamUnavailableState {
  return {
    isReplayStreamActive: false,
    isReplayModeActive: hasReceivedSnapshot,
    replayError: "Replay stream unavailable."
  };
}

export function shouldPollLiveSnapshot(
  isScenarioModeActive: boolean,
  isReplayModeActive = false,
  isReplayStreamActive = false
): boolean {
  return !isScenarioModeActive && !isReplayModeActive && !isReplayStreamActive;
}

export function shouldPollCollectorHealth(
  isScenarioModeActive: boolean,
  isReplayModeActive = false,
  isReplayStreamActive = false
): boolean {
  return shouldPollLiveSnapshot(isScenarioModeActive, isReplayModeActive, isReplayStreamActive);
}

export function canApplyLiveSnapshot({
  isScenarioModeActive,
  isReplayModeActive = false,
  isReplayStreamActive = false,
  responseRequestId,
  latestRequestId
}: LiveSnapshotApplyState): boolean {
  return !isScenarioModeActive && !isReplayModeActive && !isReplayStreamActive && responseRequestId === latestRequestId;
}

export function canApplyLiveStreamSnapshot({
  isScenarioModeActive,
  isReplayModeActive = false,
  isReplayStreamActive = false
}: LiveStreamSnapshotApplyState): boolean {
  return !isScenarioModeActive && !isReplayModeActive && !isReplayStreamActive;
}

export function canApplyScenarioSnapshot({
  responseRequestId,
  latestRequestId,
  scenarioRequestsCanceled
}: ScenarioSnapshotApplyState): boolean {
  return !scenarioRequestsCanceled && responseRequestId === latestRequestId;
}

export function canApplyReplaySnapshot({
  responseRequestId,
  latestRequestId,
  replayRequestsCanceled
}: ReplaySnapshotApplyState): boolean {
  return !replayRequestsCanceled && responseRequestId === latestRequestId;
}

export function LiveDashboard({ initialSnapshot }: LiveDashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [collectorHealth, setCollectorHealth] = useState<CollectorHealth | null>(null);
  const [liveTransportStatus, setLiveTransportStatus] = useState<LiveTransportStatus | null>(null);
  const [replaySessions, setReplaySessions] = useState<ReplaySession[]>([]);
  const [selectedReplaySessionId, setSelectedReplaySessionId] = useState<string | null>(null);
  const [selectedReplayIndex, setSelectedReplayIndex] = useState(0);
  const [isLoadingReplaySessions, setIsLoadingReplaySessions] = useState(true);
  const [isReplayModeActive, setIsReplayModeActive] = useState(false);
  const [isReplayStreamActive, setIsReplayStreamActive] = useState(false);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [spotShift, setSpotShift] = useState("0");
  const [volShift, setVolShift] = useState("0");
  const [timeShift, setTimeShift] = useState("0");
  const [isScenarioModeActive, setIsScenarioModeActive] = useState(false);
  const [isApplyingScenario, setIsApplyingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState(`${initialSnapshot.symbol} ${initialSnapshot.mode} view`);
  const [isLoadingSavedViews, setIsLoadingSavedViews] = useState(true);
  const [isSavingView, setIsSavingView] = useState(false);
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const scenarioModeRef = useRef(false);
  const replayModeRef = useRef(false);
  const latestLiveRequestIdRef = useRef(0);
  const pollingResponseRequestIdRef = useRef(0);
  const latestScenarioRequestIdRef = useRef(0);
  const scenarioRequestsCanceledRef = useRef(false);
  const latestReplayRequestIdRef = useRef(0);
  const replayRequestsCanceledRef = useRef(false);
  const stopReplayStreamRef = useRef<(() => void) | null>(null);
  const hasReplayStreamSnapshotRef = useRef(false);
  const replayStreamActiveRef = useRef(false);

  const selectedReplaySession = useMemo(
    () => replaySessions.find((session) => session.session_id === selectedReplaySessionId) ?? replaySessions[0] ?? null,
    [replaySessions, selectedReplaySessionId]
  );
  const replaySnapshotTimes = useMemo(
    () => (selectedReplaySession ? replayTimestampOptions(selectedReplaySession) : []),
    [selectedReplaySession]
  );
  const clampedReplayIndex = selectedReplaySession ? clampReplayIndex(selectedReplayIndex, selectedReplaySession) : 0;
  const selectedReplayTime = replaySnapshotTimes[clampedReplayIndex] ?? null;

  useEffect(() => {
    let isCanceled = false;

    loadClientSavedViews().then((views) => {
      if (isCanceled) {
        return;
      }

      setSavedViews(views);
      setIsLoadingSavedViews(false);
    });

    return () => {
      isCanceled = true;
    };
  }, []);

  useEffect(() => {
    let isCanceled = false;

    loadClientReplaySessions().then((sessions) => {
      if (isCanceled) {
        return;
      }

      setReplaySessions(sessions);
      setSelectedReplaySessionId(sessions[0]?.session_id ?? null);
      setSelectedReplayIndex(sessions[0] ? clampReplayIndex(Number.POSITIVE_INFINITY, sessions[0]) : 0);
      setIsLoadingReplaySessions(false);
    });

    return () => {
      isCanceled = true;
    };
  }, []);

  useEffect(() => {
    scenarioModeRef.current = isScenarioModeActive;
    replayModeRef.current = isReplayModeActive;
    replayStreamActiveRef.current = isReplayStreamActive;

    if (!shouldPollLiveSnapshot(isScenarioModeActive, isReplayModeActive, isReplayStreamActive)) {
      setLiveTransportStatus(null);
      return undefined;
    }

    return startLiveSnapshotUpdates({
      loadSnapshot: () => {
        latestLiveRequestIdRef.current += 1;
        const requestId = latestLiveRequestIdRef.current;

        return loadClientDashboardSnapshot().then((liveSnapshot) => {
          pollingResponseRequestIdRef.current = requestId;
          return liveSnapshot;
        });
      },
      applySnapshot: (liveSnapshot, source: LiveSnapshotUpdateSource) => {
        if (source === "stream") {
          if (canApplyLiveStreamSnapshot({
            isScenarioModeActive: scenarioModeRef.current,
            isReplayModeActive: replayModeRef.current,
            isReplayStreamActive: replayStreamActiveRef.current
          })) {
            setSnapshot(liveSnapshot);
          }
          return;
        }

        if (canApplyLiveSnapshot({
          isScenarioModeActive: scenarioModeRef.current,
          isReplayModeActive: replayModeRef.current,
          isReplayStreamActive: replayStreamActiveRef.current,
          responseRequestId: pollingResponseRequestIdRef.current,
          latestRequestId: latestLiveRequestIdRef.current
        })) {
          setSnapshot(liveSnapshot);
        }
      },
      intervalMs: 1000,
      onTransportStatus: setLiveTransportStatus
    });
  }, [isScenarioModeActive, isReplayModeActive, isReplayStreamActive]);

  useEffect(() => {
    return () => {
      stopReplayStreamRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!shouldPollCollectorHealth(isScenarioModeActive, isReplayModeActive, isReplayStreamActive)) {
      return undefined;
    }

    return startSnapshotPolling<CollectorHealth>({
      loadSnapshot: loadClientCollectorHealth,
      applySnapshot: setCollectorHealth,
      intervalMs: 5000
    });
  }, [isScenarioModeActive, isReplayModeActive, isReplayStreamActive]);

  const loadReplay = async () => {
    const replayRequest = createReplaySnapshotRequest(selectedReplaySessionId, selectedReplayTime);

    if (!replayRequest) {
      setReplayError("No replay sessions available.");
      return;
    }

    latestReplayRequestIdRef.current += 1;
    stopReplayStreamRef.current?.();
    stopReplayStreamRef.current = null;
    replayStreamActiveRef.current = false;
    const responseRequestId = latestReplayRequestIdRef.current;
    const replayStartState = createReplayStartState();
    scenarioRequestsCanceledRef.current = replayStartState.scenarioRequestsCanceled;
    replayRequestsCanceledRef.current = replayStartState.replayRequestsCanceled;
    setIsApplyingScenario(replayStartState.isApplyingScenario);
    setIsLoadingReplay(replayStartState.isLoadingReplay);
    setIsReplayStreamActive(false);
    setReplayError(replayStartState.replayError);

    const replaySnapshot = await loadClientReplaySnapshot(replayRequest);

    if (!canApplyReplaySnapshot({
      responseRequestId,
      latestRequestId: latestReplayRequestIdRef.current,
      replayRequestsCanceled: replayRequestsCanceledRef.current
    })) {
      return;
    }

    setIsLoadingReplay(false);

    if (!replaySnapshot) {
      setReplayError("Replay failed.");
      return;
    }

    scenarioModeRef.current = false;
    replayModeRef.current = true;
    setSnapshot(replaySnapshot);
    setIsScenarioModeActive(false);
    setIsReplayModeActive(true);
    setScenarioError(null);
  };

  const stopReplayStream = () => {
    stopReplayStreamRef.current?.();
    stopReplayStreamRef.current = null;
    replayStreamActiveRef.current = false;
    setIsReplayStreamActive(false);
  };

  const playReplayStream = () => {
    const replayRequest = createReplaySnapshotRequest(selectedReplaySessionId, selectedReplayTime);

    if (!replayRequest) {
      setReplayError("No replay sessions available.");
      return;
    }

    stopReplayStreamRef.current?.();
    latestReplayRequestIdRef.current += 1;
    const replayStartState = createReplayStreamStartState();
    scenarioRequestsCanceledRef.current = replayStartState.scenarioRequestsCanceled;
    replayRequestsCanceledRef.current = replayStartState.replayRequestsCanceled;
    hasReplayStreamSnapshotRef.current = false;
    replayStreamActiveRef.current = replayStartState.isReplayStreamActive;
    scenarioModeRef.current = false;
    replayModeRef.current = replayStartState.isReplayModeActive;
    setIsApplyingScenario(replayStartState.isApplyingScenario);
    setIsLoadingReplay(replayStartState.isLoadingReplay);
    setIsReplayStreamActive(replayStartState.isReplayStreamActive);
    setIsScenarioModeActive(false);
    setIsReplayModeActive(replayStartState.isReplayModeActive);
    setScenarioError(null);
    setReplayError(replayStartState.replayError);

    stopReplayStreamRef.current = startReplayStream({
      sessionId: replayRequest.session_id,
      at: replayRequest.at,
      intervalMs: 250,
      onSnapshot: (replaySnapshot) => {
        hasReplayStreamSnapshotRef.current = true;
        scenarioModeRef.current = false;
        replayModeRef.current = true;
        setSnapshot(replaySnapshot);
        setIsScenarioModeActive(false);
        setIsReplayModeActive(true);
        setScenarioError(null);
      },
      onComplete: () => {
        stopReplayStreamRef.current = null;
        replayStreamActiveRef.current = false;
        setIsReplayStreamActive(false);
      },
      onUnavailable: () => {
        const replayUnavailableState = createReplayStreamUnavailableState(hasReplayStreamSnapshotRef.current);
        stopReplayStreamRef.current = null;
        replayStreamActiveRef.current = replayUnavailableState.isReplayStreamActive;
        replayModeRef.current = replayUnavailableState.isReplayModeActive;
        setIsReplayStreamActive(replayUnavailableState.isReplayStreamActive);
        setIsReplayModeActive(replayUnavailableState.isReplayModeActive);
        setReplayError(replayUnavailableState.replayError);
      }
    });
  };

  const applyScenario = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    latestScenarioRequestIdRef.current += 1;
    stopReplayStreamRef.current?.();
    stopReplayStreamRef.current = null;
    replayStreamActiveRef.current = false;
    const responseRequestId = latestScenarioRequestIdRef.current;
    scenarioRequestsCanceledRef.current = false;
    replayRequestsCanceledRef.current = true;
    replayModeRef.current = false;
    setIsApplyingScenario(true);
    setIsLoadingReplay(false);
    setIsReplayStreamActive(false);
    setIsReplayModeActive(false);
    setScenarioError(null);

    const scenarioSnapshot = await requestClientScenarioSnapshot(
      createScenarioRequest(snapshot, {
        spotShift,
        volShift,
        timeShift
      })
    );

    if (!canApplyScenarioSnapshot({
      responseRequestId,
      latestRequestId: latestScenarioRequestIdRef.current,
      scenarioRequestsCanceled: scenarioRequestsCanceledRef.current
    })) {
      return;
    }

    setIsApplyingScenario(false);

    if (!scenarioSnapshot) {
      setScenarioError("Scenario failed.");
      return;
    }

    scenarioModeRef.current = true;
    replayModeRef.current = false;
    setSnapshot(scenarioSnapshot);
    setIsScenarioModeActive(true);
    setIsReplayModeActive(false);
    setReplayError(null);
  };

  const returnToLive = () => {
    stopReplayStreamRef.current?.();
    stopReplayStreamRef.current = null;
    replayStreamActiveRef.current = false;
    scenarioModeRef.current = false;
    replayModeRef.current = false;
    scenarioRequestsCanceledRef.current = true;
    replayRequestsCanceledRef.current = true;
    setIsScenarioModeActive(false);
    setIsReplayModeActive(false);
    setIsReplayStreamActive(false);
    setIsApplyingScenario(false);
    setIsLoadingReplay(false);
    setScenarioError(null);
    setReplayError(null);

    latestLiveRequestIdRef.current += 1;
    const responseRequestId = latestLiveRequestIdRef.current;

    void loadClientDashboardSnapshot().then((liveSnapshot) => {
      if (liveSnapshot && canApplyLiveSnapshot({
        isScenarioModeActive: scenarioModeRef.current,
        isReplayModeActive: replayModeRef.current,
        responseRequestId,
        latestRequestId: latestLiveRequestIdRef.current
      })) {
        setSnapshot(liveSnapshot);
      }
    });
  };

  const saveCurrentView = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = savedViewName.trim();

    if (!trimmedName) {
      setSavedViewError("Enter a view name.");
      return;
    }

    setIsSavingView(true);
    setSavedViewError(null);

    const savedView = await saveClientSavedView(buildSavedViewDraft(snapshot, {
      name: trimmedName,
      viewId: `view-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString()
    }));

    setIsSavingView(false);

    if (!savedView) {
      setSavedViewError("Saved view failed.");
      return;
    }

    setSavedViews((currentViews) => [
      ...currentViews.filter((view) => view.view_id !== savedView.view_id),
      savedView
    ]);
  };

  return (
    <DashboardView
      snapshot={snapshot}
      collectorHealth={collectorHealth}
      transportStatus={liveTransportStatus}
      replayPanel={
        <ReplayPanel
          selectedSessionId={selectedReplaySessionId}
          sessions={replaySessions}
          hasSessions={replaySessions.length > 0}
          snapshotTimes={replaySnapshotTimes}
          selectedSnapshotIndex={clampedReplayIndex}
          selectedSnapshotTime={selectedReplayTime}
          isReplayModeActive={isReplayModeActive}
          isReplayStreamActive={isReplayStreamActive}
          isLoadingSessions={isLoadingReplaySessions}
          isLoadingReplay={isLoadingReplay}
          errorMessage={replayError}
          onSelectSessionId={(sessionId) => {
            const session = replaySessions.find((candidate) => candidate.session_id === sessionId) ?? null;
            setSelectedReplaySessionId(sessionId || null);
            setSelectedReplayIndex(session ? clampReplayIndex(Number.POSITIVE_INFINITY, session) : 0);
          }}
          onSelectSnapshotIndex={(index) => {
            setSelectedReplayIndex(selectedReplaySession ? clampReplayIndex(index, selectedReplaySession) : 0);
          }}
          onLoadReplay={loadReplay}
          onPlayReplayStream={playReplayStream}
          onStopReplayStream={stopReplayStream}
          onReturnToLive={returnToLive}
        />
      }
      savedViewsPanel={
        <SavedViewsPanel
          savedViews={savedViews}
          viewName={savedViewName}
          isLoading={isLoadingSavedViews}
          isSaving={isSavingView}
          errorMessage={savedViewError}
          onViewNameChange={setSavedViewName}
          onSaveView={saveCurrentView}
        />
      }
      scenarioPanel={
        <ScenarioPanel
          spotShift={spotShift}
          volShift={volShift}
          timeShift={timeShift}
          isScenarioModeActive={isScenarioModeActive}
          isApplying={isApplyingScenario}
          errorMessage={scenarioError}
          onSpotShiftChange={setSpotShift}
          onVolShiftChange={setVolShift}
          onTimeShiftChange={setTimeShift}
          onApplyScenario={applyScenario}
          onReturnToLive={returnToLive}
        />
      }
    />
  );
}
