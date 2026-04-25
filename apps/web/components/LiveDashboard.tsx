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
  responseRequestId: number;
  latestRequestId: number;
}

interface LiveStreamSnapshotApplyState {
  isScenarioModeActive: boolean;
  isReplayModeActive?: boolean;
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

export function shouldPollLiveSnapshot(isScenarioModeActive: boolean, isReplayModeActive = false): boolean {
  return !isScenarioModeActive && !isReplayModeActive;
}

export function shouldPollCollectorHealth(isScenarioModeActive: boolean, isReplayModeActive = false): boolean {
  return shouldPollLiveSnapshot(isScenarioModeActive, isReplayModeActive);
}

export function canApplyLiveSnapshot({
  isScenarioModeActive,
  isReplayModeActive = false,
  responseRequestId,
  latestRequestId
}: LiveSnapshotApplyState): boolean {
  return !isScenarioModeActive && !isReplayModeActive && responseRequestId === latestRequestId;
}

export function canApplyLiveStreamSnapshot({
  isScenarioModeActive,
  isReplayModeActive = false
}: LiveStreamSnapshotApplyState): boolean {
  return !isScenarioModeActive && !isReplayModeActive;
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

    if (!shouldPollLiveSnapshot(isScenarioModeActive, isReplayModeActive)) {
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
            isReplayModeActive: replayModeRef.current
          })) {
            setSnapshot(liveSnapshot);
          }
          return;
        }

        if (canApplyLiveSnapshot({
          isScenarioModeActive: scenarioModeRef.current,
          isReplayModeActive: replayModeRef.current,
          responseRequestId: pollingResponseRequestIdRef.current,
          latestRequestId: latestLiveRequestIdRef.current
        })) {
          setSnapshot(liveSnapshot);
        }
      },
      intervalMs: 1000,
      onTransportStatus: setLiveTransportStatus
    });
  }, [isScenarioModeActive, isReplayModeActive]);

  useEffect(() => {
    if (!shouldPollCollectorHealth(isScenarioModeActive, isReplayModeActive)) {
      return undefined;
    }

    return startSnapshotPolling<CollectorHealth>({
      loadSnapshot: loadClientCollectorHealth,
      applySnapshot: setCollectorHealth,
      intervalMs: 5000
    });
  }, [isScenarioModeActive, isReplayModeActive]);

  const loadReplay = async () => {
    const replayRequest = createReplaySnapshotRequest(selectedReplaySessionId, selectedReplayTime);

    if (!replayRequest) {
      setReplayError("No replay sessions available.");
      return;
    }

    latestReplayRequestIdRef.current += 1;
    const responseRequestId = latestReplayRequestIdRef.current;
    const replayStartState = createReplayStartState();
    scenarioRequestsCanceledRef.current = replayStartState.scenarioRequestsCanceled;
    replayRequestsCanceledRef.current = replayStartState.replayRequestsCanceled;
    setIsApplyingScenario(replayStartState.isApplyingScenario);
    setIsLoadingReplay(replayStartState.isLoadingReplay);
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

  const applyScenario = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    latestScenarioRequestIdRef.current += 1;
    const responseRequestId = latestScenarioRequestIdRef.current;
    scenarioRequestsCanceledRef.current = false;
    replayRequestsCanceledRef.current = true;
    replayModeRef.current = false;
    setIsApplyingScenario(true);
    setIsLoadingReplay(false);
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
    scenarioModeRef.current = false;
    replayModeRef.current = false;
    scenarioRequestsCanceledRef.current = true;
    replayRequestsCanceledRef.current = true;
    setIsScenarioModeActive(false);
    setIsReplayModeActive(false);
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
