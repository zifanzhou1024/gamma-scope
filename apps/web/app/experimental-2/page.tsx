import { headers } from "next/headers";
import { ExperimentalFlowDashboard } from "../../components/ExperimentalFlowDashboard";
import { loadLatestExperimentalFlow } from "../../lib/serverExperimentalFlowSource";

export default async function Experimental2Page() {
  const initialFlow = await loadLatestExperimentalFlow(fetch, await headers());

  return <ExperimentalFlowDashboard initialFlow={initialFlow} />;
}
