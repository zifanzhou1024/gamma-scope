import type { AnalyticsSnapshot } from "./contracts";
import { loadClientDashboardSnapshot } from "./clientSnapshotSource";
import { startSnapshotPolling } from "./snapshotPolling";
import { startSnapshotStream } from "./snapshotStream";

type WebSocketLike = {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface StartLiveSnapshotUpdatesOptions {
  applySnapshot: (snapshot: AnalyticsSnapshot) => void;
  loadSnapshot?: () => Promise<AnalyticsSnapshot | null>;
  intervalMs?: number;
  websocketUrl?: string;
  WebSocketImpl?: WebSocketConstructor;
}

export function startLiveSnapshotUpdates({
  applySnapshot,
  loadSnapshot = loadClientDashboardSnapshot,
  intervalMs = 1000,
  websocketUrl,
  WebSocketImpl
}: StartLiveSnapshotUpdatesOptions): () => void {
  let stopPolling: (() => void) | null = null;

  const startPolling = () => {
    if (stopPolling) {
      return;
    }

    stopPolling = startSnapshotPolling({
      loadSnapshot,
      applySnapshot,
      intervalMs
    });
  };

  const stopStream = startSnapshotStream({
    applySnapshot,
    onUnavailable: startPolling,
    websocketUrl,
    WebSocketImpl
  });

  return () => {
    stopStream();
    stopPolling?.();
  };
}
