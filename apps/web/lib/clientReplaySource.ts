import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const REPLAY_SESSIONS_PATH = "/api/spx/0dte/replay/sessions";
const REPLAY_SNAPSHOT_PATH = "/api/spx/0dte/replay/snapshot";

export interface ReplaySession {
  session_id: string;
  symbol: string;
  expiry: string;
  start_time: string;
  end_time: string;
  snapshot_count: number;
}

export interface ReplaySnapshotRequest {
  session_id: string;
  at?: string;
}

type ReplayFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientReplayOptions = {
  fetcher?: ReplayFetcher;
};

export function isReplaySessionArray(payload: unknown): payload is ReplaySession[] {
  return Array.isArray(payload) && payload.every(isReplaySession);
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
    Number.isFinite(payload.snapshot_count)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
