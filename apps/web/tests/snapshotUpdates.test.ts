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

  emitError() {
    this.onerror?.();
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

function deferredSnapshot() {
  let resolve!: (snapshot: AnalyticsSnapshot | null) => void;
  const promise = new Promise<AnalyticsSnapshot | null>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "stream-session" }), "stream");
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
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "polling-session" }), "polling");
  });

  it("reports transport transitions through reconnect and recovery", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const onTransportStatus = vi.fn();
    const loadSnapshot = vi.fn(async () => liveSnapshot("polling-session"));

    startLiveSnapshotUpdates({
      applySnapshot,
      loadSnapshot,
      WebSocketImpl: FakeWebSocket,
      intervalMs: 1000,
      reconnectMs: 250,
      onTransportStatus
    });
    FakeWebSocket.instances[0]!.emitMessage(liveSnapshot("stream-session"));
    FakeWebSocket.instances[0]!.emitClose();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(250);
    FakeWebSocket.instances[1]!.emitMessage(liveSnapshot("recovered-session"));
    await flushMicrotasks();

    expect(onTransportStatus).toHaveBeenNthCalledWith(1, "connecting");
    expect(onTransportStatus).toHaveBeenNthCalledWith(2, "streaming");
    expect(onTransportStatus).toHaveBeenNthCalledWith(3, "disconnected");
    expect(onTransportStatus).toHaveBeenNthCalledWith(4, "fallback_polling");
    expect(onTransportStatus).toHaveBeenNthCalledWith(5, "reconnecting");
    expect(onTransportStatus).toHaveBeenNthCalledWith(6, "streaming");
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "recovered-session" }), "stream");
  });

  it("keeps disconnected visible until fallback polling returns data", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const onTransportStatus = vi.fn();
    const firstPoll = deferredSnapshot();
    const loadSnapshot = vi.fn(() => firstPoll.promise);

    startLiveSnapshotUpdates({
      applySnapshot,
      loadSnapshot,
      WebSocketImpl: FakeWebSocket,
      intervalMs: 1000,
      onTransportStatus
    });
    FakeWebSocket.instances[0]!.emitMessage(liveSnapshot("stream-session"));
    FakeWebSocket.instances[0]!.emitClose();
    await flushMicrotasks();

    expect(onTransportStatus).toHaveBeenLastCalledWith("disconnected");
    expect(onTransportStatus).not.toHaveBeenCalledWith("fallback_polling");

    firstPoll.resolve(liveSnapshot("polling-session"));
    await flushMicrotasks();

    expect(onTransportStatus).toHaveBeenLastCalledWith("fallback_polling");
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ session_id: "polling-session" }), "polling");
  });

  it("retires an unavailable stream before reconnecting", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const loadSnapshot = vi.fn(async () => liveSnapshot("polling-session"));

    startLiveSnapshotUpdates({
      applySnapshot,
      loadSnapshot,
      WebSocketImpl: FakeWebSocket,
      intervalMs: 1000,
      reconnectMs: 250
    });
    FakeWebSocket.instances[0]!.emitError();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(250);
    FakeWebSocket.instances[0]!.emitMessage(liveSnapshot("old-stream-session"));

    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    expect(applySnapshot.mock.calls.some(([snapshot]) => snapshot.session_id === "old-stream-session")).toBe(false);
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
