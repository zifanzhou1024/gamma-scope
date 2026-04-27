import { describe, expect, it } from "vitest";

import {
  formatReplayMarketTime,
  isReplayPlaybackSpeed,
  nextReplayPlaybackIndex,
  REPLAY_PLAYBACK_SPEEDS,
  REPLAY_PLAYBACK_TICK_MS
} from "../lib/replayPlayback";
import type { ReplayTimelineEntry } from "../lib/clientReplaySource";

function entry(index: number, snapshot_time: string): ReplayTimelineEntry {
  return { index, snapshot_time };
}

describe("replay playback speed helpers", () => {
  it("exposes the allowed playback speeds and tick interval", () => {
    expect(REPLAY_PLAYBACK_SPEEDS).toEqual([1, 5, 10, 30, 60]);
    expect(REPLAY_PLAYBACK_TICK_MS).toBe(1000);
  });

  it("accepts only configured replay playback speeds", () => {
    expect(isReplayPlaybackSpeed(1)).toBe(true);
    expect(isReplayPlaybackSpeed(5)).toBe(true);
    expect(isReplayPlaybackSpeed(10)).toBe(true);
    expect(isReplayPlaybackSpeed(30)).toBe(true);
    expect(isReplayPlaybackSpeed(60)).toBe(true);
    expect(isReplayPlaybackSpeed(0)).toBe(false);
    expect(isReplayPlaybackSpeed(2)).toBe(false);
    expect(isReplayPlaybackSpeed("30")).toBe(false);
    expect(isReplayPlaybackSpeed(null)).toBe(false);
  });
});

describe("nextReplayPlaybackIndex", () => {
  it("advances at 1x to the first timestamp at least one replay second later", () => {
    const entries = [
      entry(0, "2026-04-22T13:30:00.000Z"),
      entry(1, "2026-04-22T13:30:00.500Z"),
      entry(2, "2026-04-22T13:30:01.000Z"),
      entry(3, "2026-04-22T13:30:02.000Z")
    ];

    expect(nextReplayPlaybackIndex(entries, 0, 1)).toBe(2);
  });

  it("skips at 30x and 60x to the first timestamp at least that many replay seconds later", () => {
    const entries = [
      entry(0, "2026-04-22T13:30:00.000Z"),
      entry(1, "2026-04-22T13:30:29.000Z"),
      entry(2, "2026-04-22T13:30:30.000Z"),
      entry(3, "2026-04-22T13:30:59.000Z"),
      entry(4, "2026-04-22T13:31:00.000Z")
    ];

    expect(nextReplayPlaybackIndex(entries, 0, 30)).toBe(2);
    expect(nextReplayPlaybackIndex(entries, 0, 60)).toBe(4);
  });

  it("advances one index across duplicate timestamps instead of freezing", () => {
    const entries = [
      entry(0, "2026-04-22T13:30:00.000Z"),
      entry(1, "2026-04-22T13:30:00.000Z"),
      entry(2, "2026-04-22T13:30:05.000Z")
    ];

    expect(nextReplayPlaybackIndex(entries, 0, 1)).toBe(1);
  });

  it("clamps out-of-range current indexes into range", () => {
    const entries = [
      entry(0, "2026-04-22T13:30:00.000Z"),
      entry(1, "2026-04-22T13:30:02.000Z"),
      entry(2, "2026-04-22T13:30:04.000Z")
    ];

    expect(nextReplayPlaybackIndex(entries, -10, 1)).toBe(1);
    expect(nextReplayPlaybackIndex(entries, 99, 1)).toBe(2);
    expect(nextReplayPlaybackIndex([], 99, 1)).toBe(0);
  });

  it("advances one index when the current timestamp is invalid", () => {
    const entries = [
      entry(0, "2026-04-22T13:30:00.000Z"),
      entry(1, "not-a-date"),
      entry(2, "2026-04-22T13:30:05.000Z")
    ];

    expect(nextReplayPlaybackIndex(entries, 1, 1)).toBe(2);
  });
});

describe("formatReplayMarketTime", () => {
  it("formats replay timestamps in New York market time with EDT", () => {
    const label = formatReplayMarketTime("2026-04-22T13:30:02Z");

    expect(label).toContain("09:30:02");
    expect(label).toContain("EDT");
  });

  it("returns invalid timestamps unchanged", () => {
    expect(formatReplayMarketTime("not-a-date")).toBe("not-a-date");
  });
});
