import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import { startSnapshotPolling } from "../lib/snapshotPolling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("startSnapshotPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start the next poll until the current load resolves", async () => {
    vi.useFakeTimers();
    const firstLoad = deferred<AnalyticsSnapshot | null>();
    const loadSnapshot = vi.fn(() => firstLoad.promise);

    startSnapshotPolling({
      loadSnapshot,
      applySnapshot: vi.fn(),
      intervalMs: 1000
    });

    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    firstLoad.resolve(null);
    await flushMicrotasks();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it("applies non-null snapshots", async () => {
    const snapshot = {
      ...seedSnapshot,
      session_id: "polling-snapshot"
    } satisfies AnalyticsSnapshot;
    const applySnapshot = vi.fn();

    startSnapshotPolling({
      loadSnapshot: vi.fn(async () => snapshot),
      applySnapshot,
      intervalMs: 1000
    });
    await flushMicrotasks();

    expect(applySnapshot).toHaveBeenCalledWith(snapshot);
  });

  it("does not apply an in-flight snapshot after stop", async () => {
    const inFlightLoad = deferred<AnalyticsSnapshot | null>();
    const applySnapshot = vi.fn();
    const stopPolling = startSnapshotPolling({
      loadSnapshot: vi.fn(() => inFlightLoad.promise),
      applySnapshot,
      intervalMs: 1000
    });

    stopPolling();
    inFlightLoad.resolve(seedSnapshot);
    await flushMicrotasks();

    expect(applySnapshot).not.toHaveBeenCalled();
  });
});
