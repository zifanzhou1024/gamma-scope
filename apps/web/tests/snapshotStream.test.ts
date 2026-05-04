import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import {
  clientSnapshotWebSocketUrl,
  snapshotWebSocketUrl,
  startSnapshotStream
} from "../lib/snapshotStream";

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

function streamSnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "ws-live-session",
    mode: "live",
    freshness_ms: 250,
    rows: [
      {
        ...seedSnapshot.rows[0]!,
        contract_id: "SPXW-WS-C-5200",
        strike: 5200
      }
    ]
  };
}

describe("snapshotWebSocketUrl", () => {
  it("builds the default local FastAPI websocket URL", () => {
    expect(snapshotWebSocketUrl()).toBe("ws://127.0.0.1:8000/ws/spx/0dte");
  });

  it("converts http API bases to websocket URLs", () => {
    expect(snapshotWebSocketUrl("http://localhost:8010")).toBe("ws://localhost:8010/ws/spx/0dte");
    expect(snapshotWebSocketUrl("https://api.example.com/")).toBe("wss://api.example.com/ws/spx/0dte");
  });
});

describe("clientSnapshotWebSocketUrl", () => {
  it("prefers the public websocket URL env value", () => {
    const original = process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL;
    process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL = "ws://example.test/ws/spx/0dte";

    expect(clientSnapshotWebSocketUrl()).toBe("ws://example.test/ws/spx/0dte");

    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL;
    } else {
      process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL = original;
    }
  });

  it("converts a public HTTPS origin env value to the snapshot websocket URL", () => {
    const original = process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL;
    process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL = "https://gamma.hiqjj.org";

    expect(clientSnapshotWebSocketUrl()).toBe("wss://gamma.hiqjj.org/ws/spx/0dte");

    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL;
    } else {
      process.env.NEXT_PUBLIC_GAMMASCOPE_WS_URL = original;
    }
  });
});

describe("startSnapshotStream", () => {
  it("applies valid AnalyticsSnapshot messages", () => {
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const snapshot = streamSnapshot();

    startSnapshotStream({
      WebSocketImpl: FakeWebSocket,
      applySnapshot
    });

    FakeWebSocket.instances[0]!.emitMessage(snapshot);

    expect(FakeWebSocket.instances[0]!.url).toBe("ws://127.0.0.1:8000/ws/spx/0dte");
    expect(applySnapshot).toHaveBeenCalledWith(snapshot);
  });

  it("ignores invalid websocket messages", () => {
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();

    startSnapshotStream({
      WebSocketImpl: FakeWebSocket,
      applySnapshot
    });

    FakeWebSocket.instances[0]!.emitInvalidJson();
    FakeWebSocket.instances[0]!.emitMessage({ ...streamSnapshot(), symbol: "NDX" });

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it("falls back once when the stream closes or errors", () => {
    FakeWebSocket.instances = [];
    const onUnavailable = vi.fn();

    startSnapshotStream({
      WebSocketImpl: FakeWebSocket,
      applySnapshot: vi.fn(),
      onUnavailable
    });

    FakeWebSocket.instances[0]!.emitError();
    FakeWebSocket.instances[0]!.emitClose();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("closes the websocket and ignores later messages after stop", () => {
    FakeWebSocket.instances = [];
    const applySnapshot = vi.fn();
    const stop = startSnapshotStream({
      WebSocketImpl: FakeWebSocket,
      applySnapshot
    });

    stop();
    FakeWebSocket.instances[0]!.emitMessage(streamSnapshot());

    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    expect(applySnapshot).not.toHaveBeenCalled();
  });
});
