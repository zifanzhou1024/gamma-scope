import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";
import { seedSnapshot } from "./seedSnapshot";
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const SNAPSHOT_PATH = "/api/spx/0dte/snapshot/latest";

type SnapshotFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadDashboardSnapshotOptions = {
  apiBaseUrl?: string;
  fetcher?: SnapshotFetcher;
  requestHeaders?: Pick<Headers, "get">;
};

export async function loadDashboardSnapshot(options: LoadDashboardSnapshotOptions = {}): Promise<AnalyticsSnapshot> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(backendApiUrl(SNAPSHOT_PATH, undefined, options.apiBaseUrl), {
      cache: "no-store",
      headers: backendJsonHeaders(options.requestHeaders)
    });

    if (!response.ok) {
      return seedSnapshot;
    }

    const payload = await response.json();

    if (!isAnalyticsSnapshot(payload)) {
      return seedSnapshot;
    }

    return payload;
  } catch {
    return seedSnapshot;
  }
}
