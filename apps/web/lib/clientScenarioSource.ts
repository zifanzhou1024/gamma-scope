import type { AnalyticsSnapshot } from "./contracts";
import { isAnalyticsSnapshot } from "./snapshotSource";

const SCENARIO_PATH = "/api/spx/0dte/scenario";

export interface ScenarioRequest {
  session_id: string;
  snapshot_time: string;
  spot_shift_points: number;
  vol_shift_points: number;
  time_shift_minutes: number;
}

type ScenarioFetcher = (input: string, init: RequestInit) => Promise<Response>;

type RequestClientScenarioSnapshotOptions = {
  fetcher?: ScenarioFetcher;
};

export async function requestClientScenarioSnapshot(
  request: ScenarioRequest,
  options: RequestClientScenarioSnapshotOptions = {}
): Promise<AnalyticsSnapshot | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(SCENARIO_PATH, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(request)
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
