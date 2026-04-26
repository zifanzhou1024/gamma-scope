import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import {
  replayWebSocketUrl,
  startReplayStream
} from "../lib/replayStream";

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

  emitInvalidJson() {
    this.onmessage?.({ data: "not-json" });
  }

  emitClose() {
    this.onclose?.();
  }

  emitError() {
    this.onerror?.();
  }
}

function replaySnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "seed-spx-2026-04-23",
    mode: "replay",
    snapshot_time: "2026-04-23T15:40:00Z"
  };
}

describe("replayWebSocketUrl", () => {
  it("builds replay websocket URLs with encoded replay query parameters", () => {
    expect(replayWebSocketUrl({
      sessionId: "seed spx/session",
      at: "2026-04-23T15:35:00Z",
      intervalMs: 75,
      apiBaseUrl: "https://api.example.com/root"
    })).toBe(
      "wss://api.example.com/ws/spx/0dte/replay?session_id=seed+spx%2Fsession&at=2026-04-23T15%3A35%3A00Z&interval_ms=75"
    );
  });
});

describe("startReplayStream", () => {
  it("applies valid replay AnalyticsSnapshot messages", () => {
    FakeWebSocket.instances = [];
    const onSnapshot = vi.fn();
    const snapshot = replaySnapshot();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot
    });

    FakeWebSocket.instances[0]!.emitMessage(snapshot);

    expect(FakeWebSocket.instances[0]!.url).toBe(
      "ws://127.0.0.1:8000/ws/spx/0dte/replay?session_id=seed-spx-2026-04-23"
    );
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      mode: "replay",
      session_id: snapshot.session_id,
      snapshot_time: snapshot.snapshot_time,
      rows: expect.any(Array)
    }));
  });

  it("ignores invalid replay websocket messages", () => {
    FakeWebSocket.instances = [];
    const onSnapshot = vi.fn();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot
    });

    FakeWebSocket.instances[0]!.emitInvalidJson();
    FakeWebSocket.instances[0]!.emitMessage({ ...replaySnapshot(), mode: "scenario" });

    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("reports unavailable when the stream closes before any valid replay snapshot", () => {
    FakeWebSocket.instances = [];
    const onComplete = vi.fn();
    const onUnavailable = vi.fn();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot: vi.fn(),
      onComplete,
      onUnavailable
    });

    FakeWebSocket.instances[0]!.emitClose();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("reports completion when the stream closes after a valid replay snapshot", () => {
    FakeWebSocket.instances = [];
    const onComplete = vi.fn();
    const onUnavailable = vi.fn();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot: vi.fn(),
      onComplete,
      onUnavailable
    });

    FakeWebSocket.instances[0]!.emitMessage(replaySnapshot());
    FakeWebSocket.instances[0]!.emitClose();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("does not count invalid messages as replay stream availability", () => {
    FakeWebSocket.instances = [];
    const onComplete = vi.fn();
    const onUnavailable = vi.fn();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot: vi.fn(),
      onComplete,
      onUnavailable
    });

    FakeWebSocket.instances[0]!.emitInvalidJson();
    FakeWebSocket.instances[0]!.emitClose();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("reports unavailability on websocket error", () => {
    FakeWebSocket.instances = [];
    const onComplete = vi.fn();
    const onUnavailable = vi.fn();

    startReplayStream({
      WebSocketImpl: FakeWebSocket,
      sessionId: "seed-spx-2026-04-23",
      onSnapshot: vi.fn(),
      onComplete,
      onUnavailable
    });

    FakeWebSocket.instances[0]!.emitError();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
