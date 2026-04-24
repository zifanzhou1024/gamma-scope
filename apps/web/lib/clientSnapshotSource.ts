import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const SNAPSHOT_PATH = "/api/spx/0dte/snapshot/latest";

type SnapshotFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientDashboardSnapshotOptions = {
  fetcher?: SnapshotFetcher;
};

export async function loadClientDashboardSnapshot(
  options: LoadClientDashboardSnapshotOptions = {}
): Promise<AnalyticsSnapshot | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(SNAPSHOT_PATH, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();

    if (!isAnalyticsSnapshot(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
