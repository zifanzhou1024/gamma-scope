import seed from "../../../packages/contracts/fixtures/experimental-flow.seed.json";
import { isExperimentalFlow } from "./clientExperimentalFlowSource";
import type { ExperimentalFlow } from "./contracts";
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const FLOW_LATEST_PATH = "/api/spx/0dte/experimental-flow/latest";

const seedExperimentalFlow = seed as ExperimentalFlow;

export async function loadLatestExperimentalFlow(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<ExperimentalFlow> {
  try {
    const response = await fetcher(backendApiUrl(FLOW_LATEST_PATH), {
      cache: "no-store",
      headers: backendJsonHeaders(requestHeaders)
    });

    if (!response.ok) {
      return seedExperimentalFlow;
    }

    const payload = await response.json();
    return isExperimentalFlow(payload) ? payload : seedExperimentalFlow;
  } catch {
    return seedExperimentalFlow;
  }
}
