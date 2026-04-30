import { headers } from "next/headers";
import { ReplayDashboard } from "../../components/ReplayDashboard";
import { loadDashboardSnapshot } from "../../lib/serverSnapshotSource";

interface ReplayPageProps {
  searchParams?: Promise<{
    session_id?: string | string[];
  }>;
}

export default async function ReplayPage({ searchParams }: ReplayPageProps) {
  const snapshot = await loadDashboardSnapshot({ requestHeaders: await headers() });
  const params = await searchParams;
  const requestedSessionId = firstSearchParamValue(params?.session_id);

  return <ReplayDashboard initialSnapshot={snapshot} requestedSessionId={requestedSessionId} />;
}

function firstSearchParamValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
