"use client";

import React, { useEffect, useRef, useState } from "react";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { loadClientDashboardSnapshot } from "../lib/clientSnapshotSource";
import type { ScenarioRequest } from "../lib/clientScenarioSource";
import { requestClientScenarioSnapshot } from "../lib/clientScenarioSource";
import type { ReplaySnapshotRequest, ReplaySession } from "../lib/clientReplaySource";
import { loadClientReplaySessions, loadClientReplaySnapshot } from "../lib/clientReplaySource";
import { startSnapshotPolling } from "../lib/snapshotPolling";
import { DashboardView } from "./DashboardView";
import { ReplayPanel } from "./ReplayPanel";
import { ScenarioPanel } from "./ScenarioPanel";

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

export function createReplaySnapshotRequest(selectedSessionId: string | null): ReplaySnapshotRequest | null {
  return selectedSessionId ? { session_id: selectedSessionId } : null;
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

export function canApplyLiveSnapshot({
  isScenarioModeActive,
  isReplayModeActive = false,
  responseRequestId,
  latestRequestId
}: LiveSnapshotApplyState): boolean {
  return !isScenarioModeActive && !isReplayModeActive && responseRequestId === latestRequestId;
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
  const [replaySessions, setReplaySessions] = useState<ReplaySession[]>([]);
  const [selectedReplaySessionId, setSelectedReplaySessionId] = useState<string | null>(null);
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
  const scenarioModeRef = useRef(false);
  const replayModeRef = useRef(false);
  const latestLiveRequestIdRef = useRef(0);
  const pollingResponseRequestIdRef = useRef(0);
  const latestScenarioRequestIdRef = useRef(0);
  const scenarioRequestsCanceledRef = useRef(false);
  const latestReplayRequestIdRef = useRef(0);
  const replayRequestsCanceledRef = useRef(false);

  useEffect(() => {
    let isCanceled = false;

    loadClientReplaySessions().then((sessions) => {
      if (isCanceled) {
        return;
      }

      setReplaySessions(sessions);
      setSelectedReplaySessionId(sessions[0]?.session_id ?? null);
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
      return undefined;
    }

    return startSnapshotPolling({
      loadSnapshot: () => {
        latestLiveRequestIdRef.current += 1;
        const requestId = latestLiveRequestIdRef.current;

        return loadClientDashboardSnapshot().then((liveSnapshot) => {
          pollingResponseRequestIdRef.current = requestId;
          return liveSnapshot;
        });
      },
      applySnapshot: (liveSnapshot) => {
        if (canApplyLiveSnapshot({
          isScenarioModeActive: scenarioModeRef.current,
          isReplayModeActive: replayModeRef.current,
          responseRequestId: pollingResponseRequestIdRef.current,
          latestRequestId: latestLiveRequestIdRef.current
        })) {
          setSnapshot(liveSnapshot);
        }
      },
      intervalMs: 1000
    });
  }, [isScenarioModeActive, isReplayModeActive]);

  const loadReplay = async () => {
    const replayRequest = createReplaySnapshotRequest(selectedReplaySessionId);

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

  return (
    <DashboardView
      snapshot={snapshot}
      replayPanel={
        <ReplayPanel
          selectedSessionId={selectedReplaySessionId}
          hasSessions={replaySessions.length > 0}
          isReplayModeActive={isReplayModeActive}
          isLoadingSessions={isLoadingReplaySessions}
          isLoadingReplay={isLoadingReplay}
          errorMessage={replayError}
          onLoadReplay={loadReplay}
          onReturnToLive={returnToLive}
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
