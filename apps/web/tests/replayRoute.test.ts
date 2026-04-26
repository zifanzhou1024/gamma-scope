import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { ReplaySession } from "../lib/clientReplaySource";
import { seedSnapshot } from "../lib/seedSnapshot";

function replaySession(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    session_id: "route-replay-session",
    symbol: "SPX",
    expiry: "2026-04-24",
    start_time: "2026-04-24T14:30:00Z",
    end_time: "2026-04-24T16:00:00Z",
    snapshot_count: 4,
    timestamp_source: "estimated",
    ...overrides
  };
}

function replaySnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    mode: "replay",
    session_id: "route-replay-session",
    snapshot_time: "2026-04-24T15:00:00Z"
  };
}

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("GET /api/spx/0dte/replay/sessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards replay sessions to FastAPI and returns no-store JSON", async () => {
    const sessions = [
      replaySession({ timestamp_source: "exact" }),
      replaySession({ session_id: "estimated-session", timestamp_source: "estimated" })
    ];
    const fetcher = vi.fn(async () => jsonResponse(sessions));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual(sessions);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/replay/sessions", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a no-store 502 response when the sessions payload has an invalid timestamp source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ ...replaySession(), timestamp_source: "synthetic" }])));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay sessions request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the sessions upstream is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, false, 503)));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay sessions request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the sessions payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ ...replaySession(), snapshot_count: "4" }])));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay sessions request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/spx/0dte/replay/snapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards replay snapshot query parameters to FastAPI and returns no-store JSON", async () => {
    const snapshot = replaySnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/replay/snapshot/route");
    const response = await GET(new Request(
      "http://localhost/api/spx/0dte/replay/snapshot?session_id=route+session%2F1&at=2026-04-24T15%3A00%3A00Z"
    ));

    await expect(response.json()).resolves.toEqual(JSON.parse(JSON.stringify(snapshot)));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/replay/snapshot?session_id=route+session%2F1&at=2026-04-24T15%3A00%3A00Z",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("forwards source snapshot id replay snapshot query parameters to FastAPI", async () => {
    const fetcher = vi.fn(async () => jsonResponse(replaySnapshot()));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/replay/snapshot/route");
    await GET(new Request(
      "http://localhost/api/spx/0dte/replay/snapshot?session_id=route-session&at=2026-04-24T15%3A00%3A00Z&source_snapshot_id=snapshot-a"
    ));

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/replay/snapshot?session_id=route-session&at=2026-04-24T15%3A00%3A00Z&source_snapshot_id=snapshot-a",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("omits at when the replay snapshot request does not include a time", async () => {
    const fetcher = vi.fn(async () => jsonResponse(replaySnapshot()));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/replay/snapshot/route");
    await GET(new Request("http://localhost/api/spx/0dte/replay/snapshot?session_id=route-replay-session"));

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/spx/0dte/replay/snapshot?session_id=route-replay-session", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a no-store 502 response when the snapshot upstream is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, false, 503)));

    const { GET } = await import("../app/api/spx/0dte/replay/snapshot/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/replay/snapshot?session_id=route-replay-session"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay snapshot request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the snapshot payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...replaySnapshot(), symbol: "NDX" })));

    const { GET } = await import("../app/api/spx/0dte/replay/snapshot/route");
    const response = await GET(new Request("http://localhost/api/spx/0dte/replay/snapshot?session_id=route-replay-session"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay snapshot request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/spx/0dte/replay/sessions/[sessionId]/timestamps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies replay timestamps to FastAPI and returns no-store JSON", async () => {
    const timestampResponse = {
      session_id: "import session/1",
      timestamp_source: "exact",
      timestamps: [
        {
          index: 0,
          snapshot_time: "2026-04-24T14:30:00Z",
          source_snapshot_id: "snapshot-a"
        },
        {
          index: 1,
          snapshot_time: "2026-04-24T14:30:00Z",
          source_snapshot_id: "snapshot-b"
        }
      ]
    };
    const fetcher = vi.fn(async () => jsonResponse(timestampResponse));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route");
    const response = await GET(
      new Request("http://localhost/api/spx/0dte/replay/sessions/import%20session%2F1/timestamps"),
      { params: Promise.resolve({ sessionId: "import session/1" }) }
    );

    await expect(response.json()).resolves.toEqual(timestampResponse);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/spx/0dte/replay/sessions/import%20session%2F1/timestamps",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("returns a no-store 502 response when the timestamp upstream is not OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, false, 503)));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route");
    const response = await GET(
      new Request("http://localhost/api/spx/0dte/replay/sessions/import-session/timestamps"),
      { params: Promise.resolve({ sessionId: "import-session" }) }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay timestamps request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when the timestamp payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      session_id: "import-session",
      timestamp_source: "exact",
      timestamps: [{
        index: 0,
        snapshot_time: "2026-04-24T14:30:00Z",
        source_snapshot_id: null
      }]
    })));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route");
    const response = await GET(
      new Request("http://localhost/api/spx/0dte/replay/sessions/import-session/timestamps"),
      { params: Promise.resolve({ sessionId: "import-session" }) }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay timestamps request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when timestamp proxying throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const { GET } = await import("../app/api/spx/0dte/replay/sessions/[sessionId]/timestamps/route");
    const response = await GET(
      new Request("http://localhost/api/spx/0dte/replay/sessions/import-session/timestamps"),
      { params: Promise.resolve({ sessionId: "import-session" }) }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Replay timestamps request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
