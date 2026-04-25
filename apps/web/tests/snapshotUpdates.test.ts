import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import { startLiveSnapshotUpdates } from "../lib/snapshotUpdates";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose() {
    this.onclose?.();
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function liveSnapshot(sessionId: string): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    mode: "live",
    session_id: sessionId
  };
}

describe("startLiveSnapshotUpdates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies websocket snapshots without starting polling first", async () => {
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const loadSnapshot = vi.fn(async () => liveSnapshot("polling-session"));

    startLiveSnapshotUpdates({
      applySnapshot,
      loadSnapshot,
      WebSocketImpl: FakeWebSocket
    });
    FakeWebSocket.instances[0]!.emitMessage(liveSnapshot("stream-session"));
    await flushMicrotasks();

    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "stream-session" }));
  });

  it("falls back to polling after websocket close", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const loadSnapshot = vi.fn(async () => liveSnapshot("polling-session"));

    startLiveSnapshotUpdates({
      applySnapshot,
      loadSnapshot,
      WebSocketImpl: FakeWebSocket,
      intervalMs: 1000
    });
    FakeWebSocket.instances[0]!.emitClose();
    await flushMicrotasks();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "polling-session" }));
  });

  it("stops websocket and fallback polling", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const loadSnapshot = vi.fn(async () => liveSnapshot("polling-session"));
    const stop = startLiveSnapshotUpdates({
      applySnapshot: vi.fn(),
      loadSnapshot,
      WebSocketImpl: FakeWebSocket,
      intervalMs: 1000
    });

    FakeWebSocket.instances[0]!.emitClose();
    await flushMicrotasks();
    stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });
});
