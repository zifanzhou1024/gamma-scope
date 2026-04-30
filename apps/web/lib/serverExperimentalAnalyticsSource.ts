import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import { isExperimentalAnalytics } from "./clientExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "./contracts";
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";

const seedExperimentalAnalytics = seed as ExperimentalAnalytics;

export async function loadLatestExperimentalAnalytics(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<ExperimentalAnalytics> {
  try {
    const response = await fetcher(backendApiUrl(EXPERIMENTAL_LATEST_PATH), {
      cache: "no-store",
      headers: backendJsonHeaders(requestHeaders)
    });

    if (!response.ok) {
      return seedExperimentalAnalytics;
    }

    const payload = await response.json();
    return isExperimentalAnalytics(payload) ? payload : seedExperimentalAnalytics;
  } catch {
    return seedExperimentalAnalytics;
  }
}
