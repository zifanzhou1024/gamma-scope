import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const REPLAY_SESSIONS_PATH = "/api/spx/0dte/replay/sessions";
const REPLAY_SNAPSHOT_PATH = "/api/spx/0dte/replay/snapshot";

export type ReplayTimestampSource = "exact" | "estimated";

export interface ReplaySession {
  session_id: string;
  symbol: string;
  expiry: string;
  start_time: string;
  end_time: string;
  snapshot_count: number;
  timestamp_source: ReplayTimestampSource;
}

export interface ReplayTimestampEntry {
  index: number;
  snapshot_time: string;
  source_snapshot_id: string;
}

export interface ReplayTimestampResponse {
  session_id: string;
  timestamp_source: ReplayTimestampSource;
  timestamps: ReplayTimestampEntry[];
}

export interface ReplayTimelineEntry {
  index: number;
  snapshot_time: string;
  source_snapshot_id?: string;
}

export interface ReplaySnapshotRequest {
  session_id: string;
  at?: string;
  source_snapshot_id?: string;
}

type ReplayFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientReplayOptions = {
  fetcher?: ReplayFetcher;
};

export function isReplaySessionArray(payload: unknown): payload is ReplaySession[] {
  return Array.isArray(payload) && payload.every(isReplaySession);
}

export function isReplayTimestampResponse(payload: unknown): payload is ReplayTimestampResponse {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.session_id === "string" &&
    isReplayTimestampSource(payload.timestamp_source) &&
    Array.isArray(payload.timestamps) &&
    payload.timestamps.every(isReplayTimestampEntry)
  );
}

export async function loadClientReplaySessions(options: LoadClientReplayOptions = {}): Promise<ReplaySession[]> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(REPLAY_SESSIONS_PATH, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return isReplaySessionArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

export async function loadClientReplaySnapshot(
  request: ReplaySnapshotRequest,
  options: LoadClientReplayOptions = {}
): Promise<AnalyticsSnapshot | null> {
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ session_id: request.session_id });

  if (request.at) {
    params.set("at", request.at);
  }

  if (request.source_snapshot_id) {
    params.set("source_snapshot_id", request.source_snapshot_id);
  }

  try {
    const response = await fetcher(`${REPLAY_SNAPSHOT_PATH}?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isAnalyticsSnapshot(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function loadClientReplayTimestamps(
  sessionId: string,
  options: LoadClientReplayOptions = {}
): Promise<ReplayTimestampResponse | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(`${replaySessionTimestampsPath(sessionId)}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isReplayTimestampResponse(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function replayTimestampOptions(session: ReplaySession): string[] {
  const count = Math.max(1, Math.trunc(session.snapshot_count));
  const startTime = Date.parse(session.start_time);
  const endTime = Date.parse(session.end_time);

  if (count === 1) {
    return [session.start_time || session.end_time];
  }

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return [session.end_time || session.start_time];
  }

  const stepMs = (endTime - startTime) / (count - 1);
  return Array.from({ length: count }, (_, index) => new Date(startTime + stepMs * index).toISOString());
}

export function replayTimelineEntriesFromSession(session: ReplaySession): ReplayTimelineEntry[] {
  return replayTimestampOptions(session).map((snapshot_time, index) => ({
    index,
    snapshot_time
  }));
}

export function replayTimelineEntriesFromTimestamps(response: ReplayTimestampResponse): ReplayTimelineEntry[] {
  return response.timestamps.map((entry) => ({
    index: entry.index,
    snapshot_time: entry.snapshot_time,
    source_snapshot_id: entry.source_snapshot_id
  }));
}

export function clampReplayTimelineIndex(index: number, entries: ReplayTimelineEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }

  const maxIndex = entries.length - 1;

  if (!Number.isFinite(index)) {
    return maxIndex;
  }

  return Math.min(Math.max(Math.trunc(index), 0), maxIndex);
}

export function clampReplayIndex(index: number, session: ReplaySession): number {
  const maxIndex = replayTimestampOptions(session).length - 1;

  if (!Number.isFinite(index)) {
    return maxIndex;
  }

  return Math.min(Math.max(Math.trunc(index), 0), maxIndex);
}

export function stepReplayIndex(index: number, direction: -1 | 1, session: ReplaySession): number {
  return clampReplayIndex(index + direction, session);
}

function isReplaySession(payload: unknown): payload is ReplaySession {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.session_id === "string" &&
    typeof payload.symbol === "string" &&
    typeof payload.expiry === "string" &&
    typeof payload.start_time === "string" &&
    typeof payload.end_time === "string" &&
    typeof payload.snapshot_count === "number" &&
    Number.isFinite(payload.snapshot_count) &&
    isReplayTimestampSource(payload.timestamp_source)
  );
}

function isReplayTimestampEntry(payload: unknown): payload is ReplayTimestampEntry {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.index === "number" &&
    Number.isInteger(payload.index) &&
    typeof payload.snapshot_time === "string" &&
    typeof payload.source_snapshot_id === "string"
  );
}

function isReplayTimestampSource(value: unknown): value is ReplayTimestampSource {
  return value === "exact" || value === "estimated";
}

function replaySessionTimestampsPath(sessionId: string): string {
  return `${REPLAY_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/timestamps`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
