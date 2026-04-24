import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import {
  loadClientReplaySessions,
  loadClientReplaySnapshot,
  type ReplaySession
} from "../lib/clientReplaySource";

function replaySession(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    session_id: "seeded-replay-session",
    symbol: "SPX",
    expiry: "2026-04-24",
    start_time: "2026-04-24T14:30:00Z",
    end_time: "2026-04-24T16:00:00Z",
    snapshot_count: 4,
    ...overrides
  };
}

function replaySnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    mode: "replay",
    session_id: "seeded-replay-session",
    snapshot_time: "2026-04-24T15:00:00Z"
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("loadClientReplaySessions", () => {
  it("requests replay sessions from the relative API route without caching", async () => {
    const fetcher = vi.fn(async () => jsonResponse([replaySession()]));

    await loadClientReplaySessions({ fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/replay/sessions", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns valid replay session records", async () => {
    const sessions = [replaySession()];
    const fetcher = vi.fn(async () => jsonResponse(sessions));

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual(sessions);
  });

  it("returns an empty list when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual([]);
  });

  it("returns an empty list for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual([]);
  });

  it("returns an empty list for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse([{ ...replaySession(), snapshot_count: "4" }]));

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual([]);
  });
});

describe("loadClientReplaySnapshot", () => {
  it("requests a replay snapshot with session id and time without caching", async () => {
    const fetcher = vi.fn(async () => jsonResponse(replaySnapshot()));

    await loadClientReplaySnapshot(
      {
        session_id: "seeded replay/session",
        at: "2026-04-24T15:00:00Z"
      },
      { fetcher }
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/replay/snapshot?session_id=seeded+replay%2Fsession&at=2026-04-24T15%3A00%3A00Z",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("omits the time query parameter when it is absent", async () => {
    const fetcher = vi.fn(async () => jsonResponse(replaySnapshot()));

    await loadClientReplaySnapshot({ session_id: "seeded-replay-session" }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/replay/snapshot?session_id=seeded-replay-session", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a valid replay snapshot", async () => {
    const snapshot = replaySnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await expect(loadClientReplaySnapshot({ session_id: "seeded-replay-session" }, { fetcher })).resolves.toBe(snapshot);
  });

  it("returns null when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadClientReplaySnapshot({ session_id: "seeded-replay-session" }, { fetcher })).resolves.toBeNull();
  });

  it("returns null for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadClientReplaySnapshot({ session_id: "seeded-replay-session" }, { fetcher })).resolves.toBeNull();
  });

  it("returns null for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...replaySnapshot(), rows: "nope" }));

    await expect(loadClientReplaySnapshot({ session_id: "seeded-replay-session" }, { fetcher })).resolves.toBeNull();
  });
});
