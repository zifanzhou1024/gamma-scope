import React from "react";
import type { ExperimentalFlow } from "../../lib/contracts";
import { formatFlowCount, formatFlowLabel, formatFlowScore } from "./format";

interface FlowRightRailProps {
  flow: ExperimentalFlow;
}

export function FlowRightRail({ flow }: FlowRightRailProps) {
  const aggressorMix = deriveAggressorMix(flow.contractRows);
  const openingAverage = average(flow.contractRows.map((row) => row.openingScore));
  const closingAverage = average(flow.contractRows.map((row) => row.closingScore));
  const diagnostics = collectDiagnostics(flow);

  return (
    <aside className="experimentalFlowRightRail" aria-label="Flow diagnostics">
      <section className="experimentalFlowPanel">
        <div className="experimentalFlowPanelHeader">
          <div>
            <h2>Aggressor mix</h2>
            <p>Signed volume proxy by inferred aggressor.</p>
          </div>
        </div>
        <div className="experimentalFlowRailBody">
          {aggressorMix.map((item) => (
            <div className="experimentalFlowRailMetric" key={item.label}>
              <span>{item.label}</span>
              <strong>{formatFlowCount(item.value)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="experimentalFlowPanel">
        <div className="experimentalFlowPanelHeader">
          <div>
            <h2>Open/close proxy</h2>
            <p>Opening and closing scores are inferred from snapshot changes.</p>
          </div>
        </div>
        <div className="experimentalFlowRailBody experimentalFlowRailBody-two">
          <div className="experimentalFlowRailMetric">
            <span>Opening</span>
            <strong>{formatFlowScore(openingAverage)}</strong>
          </div>
          <div className="experimentalFlowRailMetric">
            <span>Closing</span>
            <strong>{formatFlowScore(closingAverage)}</strong>
          </div>
        </div>
      </section>

      <section className="experimentalFlowPanel">
        <div className="experimentalFlowPanelHeader">
          <div>
            <h2>Diagnostics</h2>
            <p>Top-level and contract-level caveats.</p>
          </div>
        </div>
        <ul className="experimentalFlowDiagnostics">
          {diagnostics.length > 0 ? (
            diagnostics.map((diagnostic) => (
              <li key={diagnostic.code}>
                <strong>{formatFlowLabel(diagnostic.severity)}</strong>
                <span>{diagnostic.code}</span>
              </li>
            ))
          ) : (
            <li>
              <strong>Info</strong>
              <span>No diagnostics</span>
            </li>
          )}
        </ul>
      </section>
    </aside>
  );
}

function deriveAggressorMix(rows: ExperimentalFlow["contractRows"]) {
  const totals = new Map<string, number>();

  rows.forEach((row) => {
    totals.set(row.aggressor, (totals.get(row.aggressor) ?? 0) + Math.abs(row.signedContracts));
  });

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([label, value]) => ({ label: formatFlowLabel(label), value }));
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function collectDiagnostics(flow: ExperimentalFlow) {
  const diagnostics = new Map<string, { code: string; severity: "info" | "warning" | "error" }>();

  flow.diagnostics.forEach((diagnostic) => {
    diagnostics.set(diagnostic.code, { code: diagnostic.code, severity: diagnostic.severity });
  });

  flow.contractRows.forEach((row) => {
    row.diagnostics.forEach((code) => {
      if (!diagnostics.has(code)) {
        diagnostics.set(code, { code, severity: "info" });
      }
    });
  });

  return Array.from(diagnostics.values());
}
