import type { ReplayTimelineEntry } from "./clientReplaySource";

export const REPLAY_PLAYBACK_SPEEDS = [1, 5, 10, 30, 60] as const;
export type ReplayPlaybackSpeed = typeof REPLAY_PLAYBACK_SPEEDS[number];
export const REPLAY_PLAYBACK_TICK_MS = 1000;

export function isReplayPlaybackSpeed(value: unknown): value is ReplayPlaybackSpeed {
  return REPLAY_PLAYBACK_SPEEDS.some((speed) => speed === value);
}

export function nextReplayPlaybackIndex(
  entries: ReplayTimelineEntry[],
  currentIndex: number,
  speed: ReplayPlaybackSpeed
): number {
  if (entries.length === 0) {
    return 0;
  }

  const lastIndex = entries.length - 1;
  const clampedIndex = clampIndex(currentIndex, lastIndex);
  const currentTimestamp = Date.parse(entries[clampedIndex]?.snapshot_time ?? "");

  if (!Number.isFinite(currentTimestamp)) {
    return Math.min(clampedIndex + 1, lastIndex);
  }

  const nextIndex = clampedIndex + 1;

  if (nextIndex > lastIndex) {
    return lastIndex;
  }

  const nextTimestamp = Date.parse(entries[nextIndex]?.snapshot_time ?? "");

  if (Number.isFinite(nextTimestamp) && nextTimestamp <= currentTimestamp) {
    return nextIndex;
  }

  const targetTimestamp = currentTimestamp + speed * REPLAY_PLAYBACK_TICK_MS;

  for (let index = nextIndex; index <= lastIndex; index += 1) {
    const timestamp = Date.parse(entries[index]?.snapshot_time ?? "");

    if (Number.isFinite(timestamp) && timestamp >= targetTimestamp) {
      return index;
    }
  }

  return lastIndex;
}

export function formatReplayMarketTime(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
    timeZoneName: "short"
  }).format(new Date(timestamp));
}

function clampIndex(currentIndex: number, lastIndex: number): number {
  if (!Number.isFinite(currentIndex)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(currentIndex), 0), lastIndex);
}
