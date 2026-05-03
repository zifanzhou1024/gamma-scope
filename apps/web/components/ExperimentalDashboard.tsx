"use client";

import React, { useEffect, useState } from "react";
import { ExperimentalSmileChart } from "./experimental/ExperimentalSmileChart";
import { ExperimentalSummaryPanels } from "./experimental/ExperimentalSummaryPanels";
import { ExperimentalTables } from "./experimental/ExperimentalTables";
import { ThemeToggle } from "./ThemeToggle";
import { loadClientExperimentalAnalytics } from "../lib/clientExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "../lib/contracts";
import { formatSnapshotTime, formatStatusLabel } from "../lib/dashboardMetrics";
import { startSnapshotPolling } from "../lib/snapshotPolling";

interface ExperimentalDashboardProps {
  initialAnalytics?: ExperimentalAnalytics | null;
}

export function ExperimentalDashboard({ initialAnalytics = null }: ExperimentalDashboardProps) {
  const [analytics, setAnalytics] = useState<ExperimentalAnalytics | null>(initialAnalytics);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    return startSnapshotPolling<ExperimentalAnalytics>({
      loadSnapshot: loadClientExperimentalAnalytics,
      applySnapshot: (nextAnalytics) => {
        setAnalytics(nextAnalytics);
        setRefreshError(null);
      },
      intervalMs: 2000
    });
  }, []);

  const refreshAnalytics = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    const nextAnalytics = await loadClientExperimentalAnalytics();
    setIsRefreshing(false);

    if (!nextAnalytics) {
      setRefreshError("Latest experimental analytics unavailable.");
      return;
    }

    setAnalytics(nextAnalytics);
  };

  return (
    <main className="dashboardShell experimentalShell">
      <header className="topBar experimentalHeader">
        <div className="topBarPrimary">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE experimental</p>
            </div>
          </div>
          <nav className="topNavTabs" aria-label="Dashboard views">
            <a className="topNavTab" href="/">
              Realtime
            </a>
            <a className="topNavTab" href="/replay">
              Replay
            </a>
            <a className="topNavTab" href="/heatmap">
              Heatmap
            </a>
            <a className="topNavTab topNavTab-active" href="/experimental" aria-current="page">
              Experimental
            </a>
            <a className="topNavTab" href="/experimental-2">
              Experimental 2
            </a>
          </nav>
        </div>
        <div className="topBarUtility experimentalHeaderUtility">
          <ThemeToggle />
          <div className="statusRail" aria-label="Experimental status">
            {analytics ? (
              <>
                <span>{formatStatusLabel(analytics.meta.mode)}</span>
                <span>{analytics.meta.symbol}</span>
                <span>Generated {formatSnapshotTime(analytics.meta.generatedAt)}</span>
              </>
            ) : (
              <span>Unavailable</span>
            )}
          </div>
          <button
            type="button"
            className="experimentalRefreshButton"
            onClick={refreshAnalytics}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      {refreshError ? (
        <section className="experimentalNotice experimentalNotice-warning" aria-label="Experimental refresh notice" role="alert">
          {refreshError}
        </section>
      ) : null}

      {analytics ? (
        <>
          <section className="sessionBand experimentalSessionBand" aria-label="Experimental source">
            <div>
              <span className="eyebrow">Session</span>
              <strong>{analytics.meta.sourceSessionId}</strong>
            </div>
            <div>
              <span className="eyebrow">Snapshot</span>
              <strong>{formatSnapshotTime(analytics.meta.sourceSnapshotTime)}</strong>
            </div>
            <div>
              <span className="eyebrow">Coverage</span>
              <strong>{analytics.sourceSnapshot.rowCount} rows / {analytics.sourceSnapshot.strikeCount} strikes</strong>
            </div>
            <div>
              <span className="eyebrow">Expiry</span>
              <strong>{analytics.meta.expiry}</strong>
            </div>
          </section>

          <ExperimentalSummaryPanels analytics={analytics} />
          <ExperimentalSmileChart analytics={analytics} />
          <ExperimentalTables analytics={analytics} />
        </>
      ) : (
        <section className="experimentalUnavailable" aria-label="Experimental analytics unavailable">
          <h2>Experimental analytics unavailable</h2>
          <p>No experimental analytics payload is available.</p>
        </section>
      )}
    </main>
  );
}
