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
import type {
  ReplaySnapshotRequest,
  ReplaySession,
  ReplayTimestampResponse,
  ReplayTimelineEntry
} from "../lib/clientReplaySource";
import {
  clampReplayTimelineIndex,
  loadClientReplaySessions,
  loadClientReplaySnapshot,
  loadClientReplayTimestamps,
  replayTimelineEntriesFromSession,
  replayTimelineEntriesFromTimestamps
} from "../lib/clientReplaySource";
import type { ReplayImportResult } from "../lib/replayImportSource";
import {
  cancelReplayImport,
  confirmReplayImport,
  uploadReplayImport
} from "../lib/replayImportSource";
import { startSnapshotPolling } from "../lib/snapshotPolling";
import { startLiveSnapshotUpdates } from "../lib/snapshotUpdates";
import type { LiveSnapshotUpdateSource } from "../lib/snapshotUpdates";
import {
  nextReplayPlaybackIndex,
  REPLAY_PLAYBACK_TICK_MS
} from "../lib/replayPlayback";
import type { ReplayPlaybackSpeed } from "../lib/replayPlayback";
import { AdminLoginPanel } from "./AdminLoginPanel";
import { ArchiveTransport } from "./ArchiveTransport";
import { DashboardView } from "./DashboardView";
import { ReplayImportPanel } from "./ReplayImportPanel";
import { SavedViewsPanel } from "./SavedViewsPanel";
import { ScenarioPanel } from "./ScenarioPanel";

export { createSavedViewDraft } from "../lib/clientSavedViewsSource";

const ADMIN_SESSION_PATH = "/api/admin/session";
const ADMIN_LOGIN_PATH = "/api/admin/login";
const ADMIN_LOGOUT_PATH = "/api/admin/logout";
const CSRF_HEADER_NAME = "X-GammaScope-CSRF";

interface ReplayDashboardProps {
  initialSnapshot: AnalyticsSnapshot;
  requestedSessionId?: string | null;
  initialAdminSession?: InitialAdminSession;
  initialReplayImport?: ReplayImportResult | null;
}

interface InitialAdminSession {
  authenticated: boolean;
  csrfToken: string | null;
  isAvailable?: boolean;
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

interface DashboardAsyncResultApplyState {
  responseRequestId: number;
  latestRequestId: number;
  isCanceled?: boolean;
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

interface DashboardAdminState {
  isAdminAuthenticated: boolean;
  isAdminAvailable: boolean;
  adminCsrfToken: string | null;
  adminErrorMessage: string | null;
}

interface ConfirmedImportReplaySelection {
  selectedReplaySessionId: string;
  selectedReplayIndex: number;
}

interface ReplaySelectionChangeState {
  latestReplayRequestId: number;
  replayRequestsCanceled: boolean;
  isReplayStreamActive: boolean;
  isLoadingReplay: boolean;
}

interface ManualReplayFrameSelectionState extends ReplaySelectionChangeState {
  selectedReplayIndex: number;
}

type ConfirmReplayImportClient = (importId: string, csrfToken: string) => Promise<ReplayImportResult | null>;
type CancelReplayImportClient = (importId: string, csrfToken: string) => Promise<ReplayImportResult | null>;
type ReplaySessionsLoader = () => Promise<ReplaySession[]>;
type DashboardFetcher = (input: string, init: RequestInit) => Promise<Response>;

interface ConfirmReplayImportDashboardActionOptions {
  importId: string;
  csrfToken: string | null;
  confirmImport?: ConfirmReplayImportClient;
  loadReplaySessions?: ReplaySessionsLoader;
}

interface ConfirmReplayImportDashboardActionResult {
  result: ReplayImportResult | null;
  replaySessions: ReplaySession[];
  selection: ConfirmedImportReplaySelection | null;
  errorMessage: string | null;
}

interface CancelReplayImportDashboardActionOptions {
  importId: string;
  currentImportId: string | null;
  csrfToken: string | null;
  cancelImport?: CancelReplayImportClient;
}

interface CancelReplayImportDashboardActionResult {
  result: ReplayImportResult | null;
  shouldClearCurrentImport: boolean;
  errorMessage: string | null;
}

interface LogoutAdminDashboardActionOptions {
  csrfToken: string | null;
  fetcher?: DashboardFetcher;
}

interface LogoutAdminDashboardActionResult {
  adminState: DashboardAdminState;
  currentReplayImport: ReplayImportResult | null;
  replayImportError: string | null;
  isUploadingReplayImport: boolean;
  isConfirmingReplayImport: boolean;
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
  selectedReplayTime?: string | null,
  sourceSnapshotId?: string | null
): ReplaySnapshotRequest | null {
  if (!selectedSessionId) {
    return null;
  }

  const request: ReplaySnapshotRequest = { session_id: selectedSessionId };

  if (selectedReplayTime) {
    request.at = selectedReplayTime;
  }

  if (sourceSnapshotId) {
    request.source_snapshot_id = sourceSnapshotId;
  }

  return request;
}

export function createReplayLoadRequest(
  selectedSessionId: string | null,
  selectedReplayEntry: ReplayTimelineEntry | null
): ReplaySnapshotRequest | null {
  if (!selectedReplayEntry) {
    return null;
  }

  return createReplaySnapshotRequest(
    selectedSessionId,
    selectedReplayEntry.snapshot_time,
    selectedReplayEntry.source_snapshot_id
  );
}

export function createReplayStreamRequest(
  selectedSessionId: string | null,
  selectedReplayEntry: ReplayTimelineEntry | null
): { sessionId: string; at: string; sourceSnapshotId?: string } | null {
  if (!selectedSessionId || !selectedReplayEntry) {
    return null;
  }

  const request: { sessionId: string; at: string; sourceSnapshotId?: string } = {
    sessionId: selectedSessionId,
    at: selectedReplayEntry.snapshot_time
  };

  if (selectedReplayEntry.source_snapshot_id) {
    request.sourceSnapshotId = selectedReplayEntry.source_snapshot_id;
  }

  return request;
}

export function shouldLoadExactReplayTimestamps(session: ReplaySession | null): boolean {
  return session?.timestamp_source === "exact";
}

export function createDashboardReplayTimelineEntries(
  session: ReplaySession | null,
  timestampResponse: ReplayTimestampResponse | null
): ReplayTimelineEntry[] {
  if (!session) {
    return [];
  }

  if (
    shouldLoadExactReplayTimestamps(session)
  ) {
    if (
      timestampResponse?.session_id === session.session_id &&
      timestampResponse.timestamp_source === "exact" &&
      timestampResponse.timestamps.length > 0
    ) {
      return replayTimelineEntriesFromTimestamps(timestampResponse);
    }

    return [];
  }

  return replayTimelineEntriesFromSession(session);
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
    replayRequestsCanceled: false,
    isApplyingScenario: false,
    isLoadingReplay: false,
    replayError: null,
    isReplayStreamActive: true,
    isReplayModeActive: true
  };
}

export function createReplayStreamUnavailableState(hasReceivedSnapshot: boolean): ReplayStreamUnavailableState {
  return {
    isReplayStreamActive: false,
    isReplayModeActive: hasReceivedSnapshot,
    replayError: "Replay stream unavailable."
  };
}

export function nextDashboardReplayPlaybackIndex(
  entries: ReplayTimelineEntry[],
  currentIndex: number,
  speed: ReplayPlaybackSpeed
): number {
  return nextReplayPlaybackIndex(entries, currentIndex, speed);
}

export function createReplayStreamStartingIndex(
  currentIndex: number,
  entries: ReplayTimelineEntry[]
): number {
  if (entries.length === 0) {
    return 0;
  }

  const finalIndex = entries.length - 1;
  const clampedIndex = clampReplayTimelineIndex(currentIndex, entries);

  return clampedIndex >= finalIndex ? 0 : clampedIndex;
}

export function createReplaySelectionChangeState(currentLatestReplayRequestId: number): ReplaySelectionChangeState {
  return {
    latestReplayRequestId: currentLatestReplayRequestId + 1,
    replayRequestsCanceled: true,
    isReplayStreamActive: false,
    isLoadingReplay: false
  };
}

export function createManualReplayFrameSelectionState(
  currentLatestReplayRequestId: number,
  selectedReplayIndex: number,
  replayTimelineEntries: ReplayTimelineEntry[]
): ManualReplayFrameSelectionState {
  return {
    ...createReplaySelectionChangeState(currentLatestReplayRequestId),
    selectedReplayIndex: clampReplayTimelineIndex(selectedReplayIndex, replayTimelineEntries)
  };
}

export function selectInitialReplaySessionId(
  sessions: ReplaySession[],
  requestedSessionId: string | null | undefined
): string | null {
  if (requestedSessionId && sessions.some((session) => session.session_id === requestedSessionId)) {
    return requestedSessionId;
  }

  return sessions[0]?.session_id ?? null;
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

export function canApplyDashboardAsyncResult({
  responseRequestId,
  latestRequestId,
  isCanceled = false
}: DashboardAsyncResultApplyState): boolean {
  return !isCanceled && responseRequestId === latestRequestId;
}

export function createDashboardAdminStateFromSessionPayload(
  payload: unknown,
  isAdminAvailable = true
): DashboardAdminState {
  if (!isRecord(payload) || payload.authenticated !== true || typeof payload.csrf_token !== "string") {
    return createLoggedOutAdminState(isAdminAvailable);
  }

  return {
    isAdminAuthenticated: true,
    isAdminAvailable,
    adminCsrfToken: payload.csrf_token,
    adminErrorMessage: null
  };
}

export function createLoggedOutAdminState(isAdminAvailable = true): DashboardAdminState {
  return {
    isAdminAuthenticated: false,
    isAdminAvailable,
    adminCsrfToken: null,
    adminErrorMessage: null
  };
}

export function shouldShowReplayImportControls(isAdminAuthenticated: boolean): boolean {
  return isAdminAuthenticated;
}

export function selectReplaySessionAfterImportConfirm(
  importResult: ReplayImportResult,
  sessions: ReplaySession[]
): ConfirmedImportReplaySelection | null {
  if (importResult.status !== "completed" || !importResult.session_id) {
    return null;
  }

  const importedSession = sessions.find((session) => session.session_id === importResult.session_id) ?? null;
  if (!importedSession) {
    return null;
  }

  return {
    selectedReplaySessionId: importedSession.session_id,
    selectedReplayIndex: 0
  };
}

export function shouldClearReplayImportAfterCancel(
  importResult: ReplayImportResult,
  currentImportId: string | null
): boolean {
  return importResult.status === "cancelled" && importResult.import_id === currentImportId;
}

export async function confirmReplayImportDashboardAction({
  importId,
  csrfToken,
  confirmImport = confirmReplayImport,
  loadReplaySessions = loadClientReplaySessions
}: ConfirmReplayImportDashboardActionOptions): Promise<ConfirmReplayImportDashboardActionResult> {
  if (!csrfToken) {
    return {
      result: null,
      replaySessions: [],
      selection: null,
      errorMessage: "Admin session expired. Log in again."
    };
  }

  const result = await confirmImport(importId, csrfToken);
  if (!result) {
    return {
      result: null,
      replaySessions: [],
      selection: null,
      errorMessage: "Replay import confirm failed."
    };
  }

  if (result.status !== "completed" || !result.session_id) {
    return {
      result,
      replaySessions: [],
      selection: null,
      errorMessage: null
    };
  }

  const replaySessions = await loadReplaySessions();

  return {
    result,
    replaySessions,
    selection: selectReplaySessionAfterImportConfirm(result, replaySessions),
    errorMessage: null
  };
}

export async function cancelReplayImportDashboardAction({
  importId,
  currentImportId,
  csrfToken,
  cancelImport = cancelReplayImport
}: CancelReplayImportDashboardActionOptions): Promise<CancelReplayImportDashboardActionResult> {
  if (!csrfToken) {
    return {
      result: null,
      shouldClearCurrentImport: false,
      errorMessage: "Admin session expired. Log in again."
    };
  }

  const result = await cancelImport(importId, csrfToken);
  if (!result) {
    return {
      result: null,
      shouldClearCurrentImport: false,
      errorMessage: "Replay import cancel failed."
    };
  }

  return {
    result,
    shouldClearCurrentImport: shouldClearReplayImportAfterCancel(result, currentImportId),
    errorMessage: null
  };
}

export async function logoutAdminDashboardAction({
  csrfToken,
  fetcher = fetch
}: LogoutAdminDashboardActionOptions): Promise<LogoutAdminDashboardActionResult> {
  await fetcher(ADMIN_LOGOUT_PATH, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {})
    }
  }).catch(() => null);

  return {
    adminState: createLoggedOutAdminState(true),
    currentReplayImport: null,
    replayImportError: null,
    isUploadingReplayImport: false,
    isConfirmingReplayImport: false
  };
}

export function ReplayDashboard({
  initialSnapshot,
  requestedSessionId = null,
  initialAdminSession,
  initialReplayImport = null
}: ReplayDashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [collectorHealth, setCollectorHealth] = useState<CollectorHealth | null>(null);
  const [liveTransportStatus, setLiveTransportStatus] = useState<LiveTransportStatus | null>(null);
  const [replaySessions, setReplaySessions] = useState<ReplaySession[]>([]);
  const [exactReplayTimestamps, setExactReplayTimestamps] = useState<ReplayTimestampResponse | null>(null);
  const [replayTimelineStatus, setReplayTimelineStatus] = useState<string | null>(null);
  const [selectedReplaySessionId, setSelectedReplaySessionId] = useState<string | null>(null);
  const [selectedReplayIndex, setSelectedReplayIndex] = useState(0);
  const [replayPlaybackSpeed, setReplayPlaybackSpeed] = useState<ReplayPlaybackSpeed>(1);
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
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(initialAdminSession?.authenticated ?? false);
  const [isAdminAvailable, setIsAdminAvailable] = useState(initialAdminSession?.isAvailable ?? true);
  const [adminCsrfToken, setAdminCsrfToken] = useState<string | null>(initialAdminSession?.csrfToken ?? null);
  const [isAdminSubmitting, setIsAdminSubmitting] = useState(false);
  const [adminErrorMessage, setAdminErrorMessage] = useState<string | null>(null);
  const [currentReplayImport, setCurrentReplayImport] = useState<ReplayImportResult | null>(initialReplayImport);
  const [isUploadingReplayImport, setIsUploadingReplayImport] = useState(false);
  const [isConfirmingReplayImport, setIsConfirmingReplayImport] = useState(false);
  const [replayImportError, setReplayImportError] = useState<string | null>(null);
  const scenarioModeRef = useRef(false);
  const replayModeRef = useRef(false);
  const latestLiveRequestIdRef = useRef(0);
  const pollingResponseRequestIdRef = useRef(0);
  const latestScenarioRequestIdRef = useRef(0);
  const scenarioRequestsCanceledRef = useRef(false);
  const latestReplayRequestIdRef = useRef(0);
  const replayRequestsCanceledRef = useRef(false);
  const replayPlaybackIntervalRef = useRef<number | null>(null);
  const replayStreamActiveRef = useRef(false);
  const replayTimelineEntriesRef = useRef<ReplayTimelineEntry[]>([]);
  const selectedReplayIndexRef = useRef(0);
  const replayPlaybackSpeedRef = useRef<ReplayPlaybackSpeed>(1);
  const adminSessionRequestIdRef = useRef(0);
  const replaySessionsRequestIdRef = useRef(0);
  const replayTimestampsRequestIdRef = useRef(0);

  const selectedReplaySession = useMemo(
    () => replaySessions.find((session) => session.session_id === selectedReplaySessionId) ?? replaySessions[0] ?? null,
    [replaySessions, selectedReplaySessionId]
  );
  const replayTimelineEntries = useMemo(
    () => createDashboardReplayTimelineEntries(selectedReplaySession, exactReplayTimestamps),
    [selectedReplaySession, exactReplayTimestamps]
  );
  const clampedReplayIndex = clampReplayTimelineIndex(selectedReplayIndex, replayTimelineEntries);
  const selectedReplayEntry = replayTimelineEntries[clampedReplayIndex] ?? null;
  const selectedReplayTime = selectedReplayEntry?.snapshot_time ?? null;

  const applyDashboardAdminState = (adminState: DashboardAdminState) => {
    setIsAdminAuthenticated(adminState.isAdminAuthenticated);
    setIsAdminAvailable(adminState.isAdminAvailable);
    setAdminCsrfToken(adminState.adminCsrfToken);
    setAdminErrorMessage(adminState.adminErrorMessage);
  };

  const nextAdminSessionRequestId = () => {
    adminSessionRequestIdRef.current += 1;
    return adminSessionRequestIdRef.current;
  };

  const nextReplaySessionsRequestId = () => {
    replaySessionsRequestIdRef.current += 1;
    return replaySessionsRequestIdRef.current;
  };

  const nextReplayTimestampsRequestId = () => {
    replayTimestampsRequestIdRef.current += 1;
    return replayTimestampsRequestIdRef.current;
  };

  useEffect(() => {
    let isCanceled = false;
    const responseRequestId = nextAdminSessionRequestId();

    loadDashboardAdminSession(isAdminAvailable).then((adminState) => {
      if (!canApplyDashboardAsyncResult({
        responseRequestId,
        latestRequestId: adminSessionRequestIdRef.current,
        isCanceled
      })) {
        return;
      }

      applyDashboardAdminState(adminState);
    });

    return () => {
      isCanceled = true;
    };
  }, []);

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
    const responseRequestId = nextReplaySessionsRequestId();

    loadClientReplaySessions().then((sessions) => {
      if (!canApplyDashboardAsyncResult({
        responseRequestId,
        latestRequestId: replaySessionsRequestIdRef.current,
        isCanceled
      })) {
        return;
      }

      setReplaySessions(sessions);
      setSelectedReplaySessionId(selectInitialReplaySessionId(sessions, requestedSessionId));
      setSelectedReplayIndex(0);
      setIsLoadingReplaySessions(false);
    });

    return () => {
      isCanceled = true;
    };
  }, [requestedSessionId]);

  useEffect(() => {
    let isCanceled = false;
    const responseRequestId = nextReplayTimestampsRequestId();

    if (!selectedReplaySession || !shouldLoadExactReplayTimestamps(selectedReplaySession)) {
      setExactReplayTimestamps(null);
      setReplayTimelineStatus(null);
      setSelectedReplayIndex((currentIndex) => clampReplayTimelineIndex(
        currentIndex,
        selectedReplaySession ? replayTimelineEntriesFromSession(selectedReplaySession) : []
      ));

      return () => {
        isCanceled = true;
      };
    }

    setExactReplayTimestamps(null);
    setReplayTimelineStatus("Loading exact replay timestamps.");

    loadClientReplayTimestamps(selectedReplaySession.session_id).then((timestampResponse) => {
      if (!canApplyDashboardAsyncResult({
        responseRequestId,
        latestRequestId: replayTimestampsRequestIdRef.current,
        isCanceled
      })) {
        return;
      }

      const nextTimestampResponse = timestampResponse?.session_id === selectedReplaySession.session_id
        && timestampResponse.timestamp_source === "exact"
        && timestampResponse.timestamps.length > 0
        ? timestampResponse
        : null;
      const nextTimelineEntries = createDashboardReplayTimelineEntries(selectedReplaySession, nextTimestampResponse);

      setExactReplayTimestamps(nextTimestampResponse);
      setReplayTimelineStatus(nextTimestampResponse ? null : "Exact replay timestamps unavailable.");
      setSelectedReplayIndex((currentIndex) => clampReplayTimelineIndex(currentIndex, nextTimelineEntries));
    });

    return () => {
      isCanceled = true;
    };
  }, [selectedReplaySession]);

  useEffect(() => {
    replayTimelineEntriesRef.current = replayTimelineEntries;
  }, [replayTimelineEntries]);

  useEffect(() => {
    selectedReplayIndexRef.current = clampedReplayIndex;
  }, [clampedReplayIndex]);

  useEffect(() => {
    replayPlaybackSpeedRef.current = replayPlaybackSpeed;
  }, [replayPlaybackSpeed]);

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
      if (replayPlaybackIntervalRef.current !== null) {
        window.clearInterval(replayPlaybackIntervalRef.current);
        replayPlaybackIntervalRef.current = null;
      }
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

  const stopReplayStream = () => {
    if (replayPlaybackIntervalRef.current !== null) {
      window.clearInterval(replayPlaybackIntervalRef.current);
      replayPlaybackIntervalRef.current = null;
    }

    replayStreamActiveRef.current = false;
    setIsReplayStreamActive(false);
  };

  const loadReplaySnapshot = async (
    replaySessionId: string | null,
    replayEntry: ReplayTimelineEntry | null,
    options: { stopPlayback: boolean }
  ) => {
    const replayRequest = createReplayLoadRequest(replaySessionId, replayEntry);

    if (!replayRequest) {
      setReplayError(replaySessionId ? "Replay timestamps unavailable." : "No replay sessions available.");
      return;
    }

    latestReplayRequestIdRef.current += 1;
    if (options.stopPlayback) {
      stopReplayStream();
    }
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

  const loadReplay = async () => {
    await loadReplaySnapshot(selectedReplaySessionId, selectedReplayEntry, { stopPlayback: true });
  };

  const playReplayStream = () => {
    if (!selectedReplaySessionId || replayTimelineEntriesRef.current.length === 0) {
      setReplayError(selectedReplaySessionId ? "Replay timestamps unavailable." : "No replay sessions available.");
      return;
    }

    stopReplayStream();
    latestReplayRequestIdRef.current += 1;
    const replayStartState = createReplayStreamStartState();
    scenarioRequestsCanceledRef.current = replayStartState.scenarioRequestsCanceled;
    replayRequestsCanceledRef.current = replayStartState.replayRequestsCanceled;
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

    const startingIndex = createReplayStreamStartingIndex(
      selectedReplayIndexRef.current,
      replayTimelineEntriesRef.current
    );
    selectedReplayIndexRef.current = startingIndex;
    setSelectedReplayIndex(startingIndex);

    replayPlaybackIntervalRef.current = window.setInterval(() => {
      const entries = replayTimelineEntriesRef.current;
      const currentIndex = selectedReplayIndexRef.current;
      const nextIndex = nextDashboardReplayPlaybackIndex(entries, currentIndex, replayPlaybackSpeedRef.current);
      const finalIndex = Math.max(entries.length - 1, 0);

      if (nextIndex !== currentIndex) {
        const replaySelectionChangeState = createReplaySelectionChangeState(latestReplayRequestIdRef.current);
        latestReplayRequestIdRef.current = replaySelectionChangeState.latestReplayRequestId;
        replayRequestsCanceledRef.current = replaySelectionChangeState.replayRequestsCanceled;
        selectedReplayIndexRef.current = nextIndex;
        setSelectedReplayIndex(nextIndex);
      }

      if (nextIndex >= finalIndex) {
        stopReplayStream();
      }
    }, REPLAY_PLAYBACK_TICK_MS);
  };

  const applyScenario = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    latestScenarioRequestIdRef.current += 1;
    stopReplayStream();
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
    stopReplayStream();
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

  useEffect(() => {
    if (isLoadingReplaySessions || !selectedReplaySessionId || !selectedReplayEntry) {
      return;
    }

    void loadReplaySnapshot(selectedReplaySessionId, selectedReplayEntry, { stopPlayback: false });
  }, [isLoadingReplaySessions, selectedReplaySessionId, selectedReplayEntry]);

  const loginAdmin = async (username: string, password: string) => {
    const responseRequestId = nextAdminSessionRequestId();
    setIsAdminSubmitting(true);
    setAdminErrorMessage(null);

    const response = await postAdminLogin(username, password);
    if (!canApplyDashboardAsyncResult({
      responseRequestId,
      latestRequestId: adminSessionRequestIdRef.current
    })) {
      return;
    }

    if (response.status === 503 && isAdminUnavailablePayload(response.payload)) {
      setIsAdminAuthenticated(false);
      setIsAdminAvailable(false);
      setAdminCsrfToken(null);
      setAdminErrorMessage(response.payload.error);
      setIsAdminSubmitting(false);
      return;
    }

    if (!response.ok || !isRecord(response.payload) || response.payload.authenticated !== true) {
      setIsAdminAuthenticated(false);
      setAdminCsrfToken(null);
      setAdminErrorMessage(errorMessageFromPayload(response.payload) ?? "Admin login failed.");
      setIsAdminSubmitting(false);
      return;
    }

    if (typeof response.payload.csrf_token === "string") {
      applyDashboardAdminState(createDashboardAdminStateFromSessionPayload(response.payload, true));
    } else {
      const adminState = await loadDashboardAdminSession(true);
      if (!canApplyDashboardAsyncResult({
        responseRequestId,
        latestRequestId: adminSessionRequestIdRef.current
      })) {
        return;
      }
      applyDashboardAdminState(adminState);
    }

    setIsAdminAvailable(true);
    setIsAdminSubmitting(false);
  };

  const logoutAdmin = async () => {
    const responseRequestId = nextAdminSessionRequestId();
    setIsAdminSubmitting(true);
    setAdminErrorMessage(null);

    const action = await logoutAdminDashboardAction({ csrfToken: adminCsrfToken });
    if (!canApplyDashboardAsyncResult({
      responseRequestId,
      latestRequestId: adminSessionRequestIdRef.current
    })) {
      return;
    }

    applyDashboardAdminState(action.adminState);
    setCurrentReplayImport(action.currentReplayImport);
    setReplayImportError(action.replayImportError);
    setIsUploadingReplayImport(action.isUploadingReplayImport);
    setIsConfirmingReplayImport(action.isConfirmingReplayImport);
    setIsAdminSubmitting(false);
  };

  const uploadReplayFiles = async (snapshots: File, quotes: File) => {
    if (!adminCsrfToken) {
      setReplayImportError("Admin session expired. Log in again.");
      return;
    }

    setIsUploadingReplayImport(true);
    setReplayImportError(null);

    const files = new FormData();
    files.append("snapshots", snapshots);
    files.append("quotes", quotes);
    const result = await uploadReplayImport(files, adminCsrfToken);

    setIsUploadingReplayImport(false);

    if (!result) {
      setReplayImportError("Replay import upload failed.");
      return;
    }

    setCurrentReplayImport(result);
  };

  const confirmReplayImportReview = async (importId: string) => {
    const responseRequestId = nextReplaySessionsRequestId();
    setIsConfirmingReplayImport(true);
    setReplayImportError(null);
    setIsLoadingReplaySessions(true);

    const action = await confirmReplayImportDashboardAction({
      importId,
      csrfToken: adminCsrfToken
    });
    if (!canApplyDashboardAsyncResult({
      responseRequestId,
      latestRequestId: replaySessionsRequestIdRef.current
    })) {
      return;
    }

    if (!action.result) {
      setReplayImportError(action.errorMessage);
      setIsConfirmingReplayImport(false);
      setIsLoadingReplaySessions(false);
      return;
    }

    setCurrentReplayImport(action.result);

    if (action.result.status === "completed" && action.result.session_id) {
      const replaySelectionChangeState = createReplaySelectionChangeState(latestReplayRequestIdRef.current);
      latestReplayRequestIdRef.current = replaySelectionChangeState.latestReplayRequestId;
      replayRequestsCanceledRef.current = replaySelectionChangeState.replayRequestsCanceled;
      stopReplayStream();
      setIsLoadingReplay(replaySelectionChangeState.isLoadingReplay);
      setReplaySessions(action.replaySessions);
      if (action.selection) {
        setSelectedReplaySessionId(action.selection.selectedReplaySessionId);
        setSelectedReplayIndex(action.selection.selectedReplayIndex);
      }
    }

    setIsLoadingReplaySessions(false);
    setIsConfirmingReplayImport(false);
  };

  const cancelReplayImportReview = async (importId: string) => {
    setIsConfirmingReplayImport(true);
    setReplayImportError(null);

    const action = await cancelReplayImportDashboardAction({
      importId,
      currentImportId: currentReplayImport?.import_id ?? null,
      csrfToken: adminCsrfToken
    });
    setIsConfirmingReplayImport(false);

    if (!action.result) {
      setReplayImportError(action.errorMessage);
      return;
    }

    if (action.shouldClearCurrentImport) {
      setCurrentReplayImport(null);
      return;
    }

    setCurrentReplayImport(action.result);
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
      activeDashboard="replay"
      adminUtility={
        <AdminLoginPanel
          isAuthenticated={isAdminAuthenticated}
          isAvailable={isAdminAvailable}
          isSubmitting={isAdminSubmitting}
          errorMessage={adminErrorMessage}
          onLogin={loginAdmin}
          onLogout={logoutAdmin}
        />
      }
      replayPanel={
        <div className="replayWorkstationControls">
          <ArchiveTransport
            selectedSessionId={selectedReplaySessionId}
            sessions={replaySessions}
            hasSessions={replaySessions.length > 0}
            timelineEntries={replayTimelineEntries}
            selectedSnapshotIndex={clampedReplayIndex}
            selectedTimelineEntry={selectedReplayEntry}
            selectedPlaybackSpeed={replayPlaybackSpeed}
            isReplayModeActive={isReplayModeActive}
            isReplayStreamActive={isReplayStreamActive}
            isLoadingSessions={isLoadingReplaySessions}
            isLoadingReplay={isLoadingReplay}
            errorMessage={replayError ?? replayTimelineStatus}
            onSelectSessionId={(sessionId) => {
              const replaySelectionChangeState = createReplaySelectionChangeState(latestReplayRequestIdRef.current);
              latestReplayRequestIdRef.current = replaySelectionChangeState.latestReplayRequestId;
              replayRequestsCanceledRef.current = replaySelectionChangeState.replayRequestsCanceled;
              stopReplayStream();
              setSelectedReplaySessionId(sessionId || null);
              setSelectedReplayIndex(0);
              setIsLoadingReplay(replaySelectionChangeState.isLoadingReplay);
            }}
            onSelectSnapshotIndex={(index) => {
              const replaySelectionChangeState = createManualReplayFrameSelectionState(
                latestReplayRequestIdRef.current,
                index,
                replayTimelineEntries
              );
              latestReplayRequestIdRef.current = replaySelectionChangeState.latestReplayRequestId;
              replayRequestsCanceledRef.current = replaySelectionChangeState.replayRequestsCanceled;
              stopReplayStream();
              setIsLoadingReplay(replaySelectionChangeState.isLoadingReplay);
              setSelectedReplayIndex(replaySelectionChangeState.selectedReplayIndex);
            }}
            onSelectPlaybackSpeed={setReplayPlaybackSpeed}
            onLoadReplay={loadReplay}
            onPlayReplayStream={playReplayStream}
            onStopReplayStream={stopReplayStream}
            onReturnToLive={returnToLive}
          />
          <div className="replaySecondaryTools">
            <ReplayImportPanel
              isAdminAuthenticated={shouldShowReplayImportControls(isAdminAuthenticated)}
              csrfToken={adminCsrfToken}
              currentImport={currentReplayImport}
              isUploading={isUploadingReplayImport}
              isConfirming={isConfirmingReplayImport}
              errorMessage={replayImportError}
              onUpload={uploadReplayFiles}
              onConfirm={confirmReplayImportReview}
              onCancel={cancelReplayImportReview}
            />
          </div>
        </div>
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

async function loadDashboardAdminSession(isAdminAvailable = true): Promise<DashboardAdminState> {
  try {
    const response = await fetch(ADMIN_SESSION_PATH, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return createLoggedOutAdminState(isAdminAvailable);
    }

    return createDashboardAdminStateFromSessionPayload(await response.json(), isAdminAvailable);
  } catch {
    return createLoggedOutAdminState(isAdminAvailable);
  }
}

async function postAdminLogin(username: string, password: string): Promise<{
  ok: boolean;
  status: number;
  payload: unknown;
}> {
  try {
    const response = await fetch(ADMIN_LOGIN_PATH, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    return {
      ok: response.ok,
      status: response.status,
      payload: await readJsonPayload(response)
    };
  } catch {
    return {
      ok: false,
      status: 0,
      payload: null
    };
  }
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAdminUnavailablePayload(payload: unknown): payload is { authenticated: false; error: string } {
  return isRecord(payload)
    && payload.authenticated === false
    && payload.error === "Admin login unavailable";
}

function errorMessageFromPayload(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
