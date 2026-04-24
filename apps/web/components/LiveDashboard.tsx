"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { loadClientDashboardSnapshot } from "../lib/clientSnapshotSource";
import { startSnapshotPolling } from "../lib/snapshotPolling";
import { DashboardView } from "./DashboardView";

interface LiveDashboardProps {
  initialSnapshot: AnalyticsSnapshot;
}

export function LiveDashboard({ initialSnapshot }: LiveDashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    return startSnapshotPolling({
      loadSnapshot: loadClientDashboardSnapshot,
      applySnapshot: setSnapshot,
      intervalMs: 1000
    });
  }, []);

  return <DashboardView snapshot={snapshot} />;
}
