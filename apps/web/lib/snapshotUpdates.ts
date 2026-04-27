import type { AnalyticsSnapshot } from "./contracts";
import { loadClientDashboardSnapshot } from "./clientSnapshotSource";
import type { LiveTransportStatus } from "./dashboardMetrics";
import { startSnapshotPolling } from "./snapshotPolling";
import { startSnapshotStream } from "./snapshotStream";

type WebSocketLike = {
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;
export type LiveSnapshotUpdateSource = "polling" | "stream";

interface StartLiveSnapshotUpdatesOptions {
  applySnapshot: (snapshot: AnalyticsSnapshot, source: LiveSnapshotUpdateSource) => void;
  loadSnapshot?: () => Promise<AnalyticsSnapshot | null>;
  intervalMs?: number;
  reconnectMs?: number;
  websocketUrl?: string;
  WebSocketImpl?: WebSocketConstructor;
  onTransportStatus?: (status: LiveTransportStatus) => void;
}

export function startLiveSnapshotUpdates({
  applySnapshot,
  loadSnapshot = loadClientDashboardSnapshot,
  intervalMs = 2000,
  reconnectMs = 2500,
  websocketUrl,
  WebSocketImpl,
  onTransportStatus
}: StartLiveSnapshotUpdatesOptions): () => void {
  let stopPolling: (() => void) | null = null;
  let stopStream: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAppliedSnapshotKey: string | null = null;
  let isStopped = false;

  const reportTransportStatus = (status: LiveTransportStatus) => {
    onTransportStatus?.(status);
  };

  const startPolling = () => {
    if (stopPolling) {
      return;
    }

    stopPolling = startSnapshotPolling({
      loadSnapshot,
      applySnapshot: (snapshot) => {
        applyChangedSnapshot(snapshot, "polling");
      },
      intervalMs
    });
  };

  const applyChangedSnapshot = (snapshot: AnalyticsSnapshot, source: LiveSnapshotUpdateSource) => {
    const snapshotKey = liveSnapshotUpdateKey(snapshot);
    if (snapshotKey === lastAppliedSnapshotKey) {
      return;
    }

    lastAppliedSnapshotKey = snapshotKey;
    reportTransportStatus(source === "stream" ? "streaming" : "fallback_polling");
    applySnapshot(snapshot, source);
  };

  const stopPollingIfActive = () => {
    stopPolling?.();
    stopPolling = null;
  };

  const stopStreamIfActive = () => {
    const stopActiveStream = stopStream;
    stopStream = null;
    stopActiveStream?.();
  };

  const scheduleReconnect = () => {
    if (isStopped || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (isStopped) {
        return;
      }
      reportTransportStatus("reconnecting");
      openStream();
    }, reconnectMs);
  };

  const handleUnavailable = () => {
    stopStreamIfActive();
    reportTransportStatus("disconnected");
    startPolling();
    scheduleReconnect();
  };

  const openStream = () => {
    stopStream = startSnapshotStream({
      applySnapshot: (snapshot) => {
        stopPollingIfActive();
        applyChangedSnapshot(snapshot, "stream");
      },
      onUnavailable: handleUnavailable,
      websocketUrl,
      WebSocketImpl
    });
  };

  reportTransportStatus("connecting");
  openStream();

  return () => {
    isStopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopStreamIfActive();
    stopPolling?.();
  };
}

export function liveSnapshotUpdateKey(snapshot: AnalyticsSnapshot): string {
  return [
    snapshot.mode,
    snapshot.session_id,
    snapshot.expiry,
    roundedSnapshotSecond(snapshot.snapshot_time),
    snapshot.rows.length
  ].join("|");
}

function roundedSnapshotSecond(snapshotTime: string): string {
  const timestampMs = Date.parse(snapshotTime);
  if (!Number.isFinite(timestampMs)) {
    return snapshotTime;
  }

  return new Date(Math.floor(timestampMs / 1000) * 1000).toISOString();
}
