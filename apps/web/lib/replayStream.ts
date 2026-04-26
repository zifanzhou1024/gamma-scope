import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const REPLAY_WS_PATH = "/ws/spx/0dte/replay";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

type WebSocketLike = {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface ReplayWebSocketUrlOptions {
  sessionId: string;
  at?: string | null;
  sourceSnapshotId?: string | null;
  intervalMs?: number;
  apiBaseUrl?: string;
}

interface StartReplayStreamOptions {
  sessionId: string;
  at?: string | null;
  sourceSnapshotId?: string | null;
  intervalMs?: number;
  onSnapshot: (snapshot: AnalyticsSnapshot) => void;
  onComplete?: () => void;
  onUnavailable?: () => void;
  websocketUrl?: string;
  WebSocketImpl?: WebSocketConstructor;
}

export function replayWebSocketUrl({
  sessionId,
  at,
  sourceSnapshotId,
  intervalMs,
  apiBaseUrl = DEFAULT_API_BASE_URL
}: ReplayWebSocketUrlOptions): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = REPLAY_WS_PATH;
  url.search = "";
  url.hash = "";
  url.searchParams.set("session_id", sessionId);

  if (at) {
    url.searchParams.set("at", at);
  }

  if (sourceSnapshotId) {
    url.searchParams.set("source_snapshot_id", sourceSnapshotId);
  }

  if (intervalMs !== undefined) {
    url.searchParams.set("interval_ms", String(intervalMs));
  }

  return url.toString();
}

export function clientReplayWebSocketUrl(options: Omit<ReplayWebSocketUrlOptions, "apiBaseUrl">): string {
  return replayWebSocketUrl({
    ...options,
    apiBaseUrl: process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL || DEFAULT_API_BASE_URL
  });
}

export function startReplayStream({
  sessionId,
  at,
  sourceSnapshotId,
  intervalMs,
  onSnapshot,
  onComplete,
  onUnavailable,
  websocketUrl = clientReplayWebSocketUrl({ sessionId, at, sourceSnapshotId, intervalMs }),
  WebSocketImpl
}: StartReplayStreamOptions): () => void {
  const SocketConstructor = WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);

  if (!SocketConstructor) {
    onUnavailable?.();
    return () => undefined;
  }

  let active = true;
  let finished = false;
  let hasReceivedSnapshot = false;
  const socket = new SocketConstructor(websocketUrl);

  socket.onmessage = (event) => {
    if (!active) {
      return;
    }

    const snapshot = _parseReplaySnapshot(event.data);
    if (snapshot) {
      hasReceivedSnapshot = true;
      onSnapshot(snapshot);
    }
  };
  socket.onclose = () => {
    if (!active || finished) {
      return;
    }

    finished = true;
    if (hasReceivedSnapshot) {
      onComplete?.();
      return;
    }
    onUnavailable?.();
  };
  socket.onerror = () => {
    if (!active || finished) {
      return;
    }

    finished = true;
    onUnavailable?.();
  };

  return () => {
    active = false;
    socket.close();
  };
}

function _parseReplaySnapshot(payload: string): AnalyticsSnapshot | null {
  try {
    const parsedPayload: unknown = JSON.parse(payload);
    if (!isAnalyticsSnapshot(parsedPayload) || parsedPayload.mode !== "replay") {
      return null;
    }
    return parsedPayload;
  } catch {
    return null;
  }
}
