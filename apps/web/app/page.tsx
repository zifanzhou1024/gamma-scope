import { LiveDashboard } from "../components/LiveDashboard";
import { loadDashboardSnapshot } from "../lib/snapshotSource";

export default async function Home() {
  const snapshot = await loadDashboardSnapshot();
  return <LiveDashboard initialSnapshot={snapshot} />;
}
