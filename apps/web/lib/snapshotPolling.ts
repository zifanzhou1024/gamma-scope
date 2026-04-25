interface StartSnapshotPollingOptions<T> {
  loadSnapshot: () => Promise<T | null>;
  applySnapshot: (snapshot: T) => void;
  intervalMs: number;
}

export function startSnapshotPolling<T>({
  loadSnapshot,
  applySnapshot,
  intervalMs
}: StartSnapshotPollingOptions<T>): () => void {
  let active = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const scheduleNextPoll = () => {
    if (!active) {
      return;
    }

    timeoutId = setTimeout(() => {
      void poll();
    }, intervalMs);
  };

  const poll = async () => {
    try {
      const snapshot = await loadSnapshot();

      if (!active) {
        return;
      }

      if (snapshot) {
        applySnapshot(snapshot);
      }
    } finally {
      scheduleNextPoll();
    }
  };

  void poll();

  return () => {
    active = false;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}
