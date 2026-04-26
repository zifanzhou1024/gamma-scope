import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const SNAPSHOT_WS_PATH = "/ws/spx/0dte";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

type WebSocketLike = {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface StartSnapshotStreamOptions {
  applySnapshot: (snapshot: AnalyticsSnapshot) => void;
  onUnavailable?: () => void;
  websocketUrl?: string;
  WebSocketImpl?: WebSocketConstructor;
}

export function snapshotWebSocketUrl(apiBaseUrl = DEFAULT_API_BASE_URL): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = SNAPSHOT_WS_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function clientSnapshotWebSocketUrl(): string {
  return process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL || snapshotWebSocketUrl();
}

export function startSnapshotStream({
  applySnapshot,
  onUnavailable,
  websocketUrl = clientSnapshotWebSocketUrl(),
  WebSocketImpl
}: StartSnapshotStreamOptions): () => void {
  const SocketConstructor = WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);

  if (!SocketConstructor) {
    onUnavailable?.();
    return () => undefined;
  }

  let active = true;
  let unavailableReported = false;
  const socket = new SocketConstructor(websocketUrl);

  const reportUnavailable = () => {
    if (!active || unavailableReported) {
      return;
    }

    unavailableReported = true;
    onUnavailable?.();
  };

  socket.onmessage = (event) => {
    if (!active) {
      return;
    }

    const snapshot = _parseSnapshot(event.data);
    if (snapshot) {
      applySnapshot(snapshot);
    }
  };
  socket.onerror = reportUnavailable;
  socket.onclose = reportUnavailable;

  return () => {
    active = false;
    socket.close();
  };
}

function _parseSnapshot(payload: string): AnalyticsSnapshot | null {
  try {
    const parsedPayload: unknown = JSON.parse(payload);
    return isAnalyticsSnapshot(parsedPayload) ? parsedPayload : null;
  } catch {
    return null;
  }
}
