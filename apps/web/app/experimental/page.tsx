import { headers } from "next/headers";
import { ExperimentalDashboard } from "../../components/ExperimentalDashboard";
import { loadLatestExperimentalAnalytics } from "../../lib/serverExperimentalAnalyticsSource";

export default async function ExperimentalPage() {
  const initialAnalytics = await loadLatestExperimentalAnalytics(fetch, await headers());

  return <ExperimentalDashboard initialAnalytics={initialAnalytics} />;
}
