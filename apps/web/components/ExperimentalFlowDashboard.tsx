"use client";

import React, { useEffect, useState } from "react";
import { FlowAuditTable } from "./experimental-flow/FlowAuditTable";
import { FlowKpiStrip } from "./experimental-flow/FlowKpiStrip";
import { FlowRightRail } from "./experimental-flow/FlowRightRail";
import { FlowStrikeLadder } from "./experimental-flow/FlowStrikeLadder";
import { ThemeToggle } from "./ThemeToggle";
import { loadClientExperimentalFlow } from "../lib/clientExperimentalFlowSource";
import type { ExperimentalFlow } from "../lib/contracts";
import { formatSnapshotTime, formatStatusLabel } from "../lib/dashboardMetrics";
import { startSnapshotPolling } from "../lib/snapshotPolling";

interface ExperimentalFlowDashboardProps {
  initialFlow?: ExperimentalFlow | null;
}

export function ExperimentalFlowDashboard({ initialFlow = null }: ExperimentalFlowDashboardProps) {
  const [flow, setFlow] = useState<ExperimentalFlow | null>(initialFlow);

  useEffect(() => {
    return startSnapshotPolling<ExperimentalFlow>({
      loadSnapshot: loadClientExperimentalFlow,
      applySnapshot: setFlow,
      intervalMs: 2000
    });
  }, []);

  return (
    <main className="dashboardShell experimentalFlowShell">
      <header className="topBar experimentalFlowHeader">
        <div className="topBarPrimary">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE estimated flow</p>
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
            <a className="topNavTab" href="/experimental">
              Experimental
            </a>
            <a className="topNavTab topNavTab-active" href="/experimental-2" aria-current="page">
              Experimental 2
            </a>
          </nav>
        </div>
        <div className="topBarUtility experimentalFlowHeaderUtility">
          <ThemeToggle />
          <div className="statusRail" aria-label="Experimental flow status">
            {flow ? (
              <>
                <span>{formatStatusLabel(flow.meta.mode)}</span>
                <span>{flow.meta.symbol}</span>
                <span>Generated {formatSnapshotTime(flow.meta.generatedAt)}</span>
              </>
            ) : (
              <span>Unavailable</span>
            )}
          </div>
        </div>
      </header>

      {flow ? (
        <>
          <section className="sessionBand experimentalFlowSessionBand" aria-label="Experimental flow source">
            <div>
              <span className="eyebrow">Session</span>
              <strong>{flow.meta.sourceSessionId}</strong>
            </div>
            <div>
              <span className="eyebrow">Current snapshot</span>
              <strong>{formatSnapshotTime(flow.meta.currentSnapshotTime)}</strong>
            </div>
            <div>
              <span className="eyebrow">Previous snapshot</span>
              <strong>{flow.meta.previousSnapshotTime ? formatSnapshotTime(flow.meta.previousSnapshotTime) : "Waiting"}</strong>
            </div>
            <div>
              <span className="eyebrow">Expiry</span>
              <strong>{flow.meta.expiry}</strong>
            </div>
          </section>

          <FlowKpiStrip flow={flow} />
          <section className="experimentalFlowMainGrid" aria-label="Experimental flow cockpit">
            <FlowStrikeLadder rows={flow.strikeRows} />
            <FlowRightRail flow={flow} />
          </section>
          <FlowAuditTable rows={flow.contractRows} />
        </>
      ) : (
        <section className="experimentalFlowUnavailable" aria-label="Experimental flow unavailable">
          <h2>Experimental flow unavailable</h2>
          <p>No experimental flow payload is available.</p>
        </section>
      )}
    </main>
  );
}
