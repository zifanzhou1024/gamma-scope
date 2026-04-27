import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import {
  clampReplayIndex,
  loadClientReplaySessions,
  loadClientReplaySnapshot,
  replayTimestampOptions,
  stepReplayIndex,
  type ReplaySession
} from "../lib/clientReplaySource";
import * as clientReplaySource from "../lib/clientReplaySource";

function replaySession(overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    session_id: "seeded-replay-session",
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
    const sessions = [
      replaySession({ timestamp_source: "exact" }),
      replaySession({ session_id: "estimated-session", timestamp_source: "estimated" })
    ];
    const fetcher = vi.fn(async () => jsonResponse(sessions));

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual(sessions);
  });

  it("returns an empty list when a replay session has an invalid timestamp source", async () => {
    const fetcher = vi.fn(async () => jsonResponse([{ ...replaySession(), timestamp_source: "synthetic" }]));

    await expect(loadClientReplaySessions({ fetcher })).resolves.toEqual([]);
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

describe("loadClientReplayTimestamps", () => {
  it("requests exact replay timestamp entries for a session without caching", async () => {
    const response = {
      session_id: "import session/1",
      timestamp_source: "exact",
      timestamps: [
        {
          index: 0,
          snapshot_time: "2026-04-24T14:30:00Z",
          source_snapshot_id: "snapshot-a"
        }
      ]
    };
    const fetcher = vi.fn(async () => jsonResponse(response));

    await clientReplaySource.loadClientReplayTimestamps("import session/1", { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/replay/sessions/import%20session%2F1/timestamps",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("returns valid replay timestamp responses with duplicate timestamp rows intact", async () => {
    const response = {
      session_id: "import-session",
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
    const fetcher = vi.fn(async () => jsonResponse(response));

    await expect(clientReplaySource.loadClientReplayTimestamps("import-session", { fetcher })).resolves.toEqual(response);
  });

  it("returns null for invalid replay timestamp responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      session_id: "import-session",
      timestamp_source: "exact",
      timestamps: [{
        index: 0,
        snapshot_time: "2026-04-24T14:30:00Z",
        source_snapshot_id: 42
      }]
    }));

    await expect(clientReplaySource.loadClientReplayTimestamps("import-session", { fetcher })).resolves.toBeNull();
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

  it("forwards the source snapshot id when it is present", async () => {
    const fetcher = vi.fn(async () => jsonResponse(replaySnapshot()));

    await loadClientReplaySnapshot(
      {
        session_id: "seeded-replay-session",
        at: "2026-04-24T15:00:00Z",
        source_snapshot_id: "snapshot-a"
      },
      { fetcher }
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/spx/0dte/replay/snapshot?session_id=seeded-replay-session&at=2026-04-24T15%3A00%3A00Z&source_snapshot_id=snapshot-a",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
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

describe("replay timestamp helpers", () => {
  it("derives evenly spaced replay timestamp options from session metadata", () => {
    expect(replayTimestampOptions(replaySession())).toEqual([
      "2026-04-24T14:30:00.000Z",
      "2026-04-24T15:00:00.000Z",
      "2026-04-24T15:30:00.000Z",
      "2026-04-24T16:00:00.000Z"
    ]);
  });

  it("converts exact timestamp responses into stable selectable timeline entries", () => {
    expect(clientReplaySource.replayTimelineEntriesFromTimestamps({
      session_id: "import-session",
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
    })).toEqual([
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
    ]);
  });

  it("keeps estimated sessions on the existing evenly spaced fallback timeline", () => {
    expect(clientReplaySource.replayTimelineEntriesFromSession(replaySession({
      timestamp_source: "estimated"
    }))).toEqual([
      {
        index: 0,
        snapshot_time: "2026-04-24T14:30:00.000Z"
      },
      {
        index: 1,
        snapshot_time: "2026-04-24T15:00:00.000Z"
      },
      {
        index: 2,
        snapshot_time: "2026-04-24T15:30:00.000Z"
      },
      {
        index: 3,
        snapshot_time: "2026-04-24T16:00:00.000Z"
      }
    ]);
  });

  it("clamps replay indexes against exact timeline entry counts", () => {
    const entries = [
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
    ];

    expect(clientReplaySource.clampReplayTimelineIndex(99, entries)).toBe(1);
    expect(clientReplaySource.clampReplayTimelineIndex(-1, entries)).toBe(0);
  });

  it("returns a single timestamp for one-snapshot sessions", () => {
    expect(replayTimestampOptions(replaySession({
      start_time: "2026-04-24T14:30:00Z",
      end_time: "2026-04-24T14:30:00Z",
      snapshot_count: 1
    }))).toEqual(["2026-04-24T14:30:00Z"]);
  });

  it("clamps selected replay indexes to the available timestamp range", () => {
    const session = replaySession();

    expect(clampReplayIndex(-1, session)).toBe(0);
    expect(clampReplayIndex(2, session)).toBe(2);
    expect(clampReplayIndex(99, session)).toBe(3);
    expect(clampReplayIndex(Number.NaN, session)).toBe(3);
  });

  it("steps replay indexes backward and forward within the available range", () => {
    const session = replaySession();

    expect(stepReplayIndex(2, -1, session)).toBe(1);
    expect(stepReplayIndex(2, 1, session)).toBe(3);
    expect(stepReplayIndex(0, -1, session)).toBe(0);
    expect(stepReplayIndex(3, 1, session)).toBe(3);
  });
});
