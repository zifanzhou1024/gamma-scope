import React from "react";
import type { ExperimentalFlow } from "../../lib/contracts";
import {
  formatFlowCount,
  formatFlowGreek,
  formatFlowLabel,
  formatFlowPremium,
  formatFlowStrike,
  formatSignedFlow
} from "./format";

interface FlowAuditTableProps {
  rows: ExperimentalFlow["contractRows"];
}

export function FlowAuditTable({ rows }: FlowAuditTableProps) {
  return (
    <section className="experimentalFlowPanel experimentalFlowAuditTable" aria-label="Contract audit">
      <div className="experimentalFlowPanelHeader">
        <div>
          <h2>Contract audit</h2>
          <p>Per-contract inferred side, flow, Greeks, and confidence.</p>
        </div>
      </div>
      <div className="experimentalFlowTableWrap">
        <table className="experimentalFlowTable experimentalFlowTable-audit">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Side</th>
              <th>Strike</th>
              <th>Vol delta</th>
              <th>Aggressor</th>
              <th>Signed</th>
              <th>Premium</th>
              <th>Gamma</th>
              <th>Vanna</th>
              <th>Theta</th>
              <th>Confidence</th>
              <th>Diagnostics</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.contractId}>
                  <td>{row.contractId}</td>
                  <td>{formatFlowLabel(row.right)}</td>
                  <td>{formatFlowStrike(row.strike)}</td>
                  <td>{formatFlowCount(row.volumeDelta)}</td>
                  <td>{formatFlowLabel(row.aggressor)}</td>
                  <td>{formatSignedFlow(row.signedContracts)}</td>
                  <td>{formatFlowPremium(row.premiumFlow)}</td>
                  <td>{formatFlowGreek(row.gammaFlow)}</td>
                  <td>{formatFlowGreek(row.vannaFlow)}</td>
                  <td>{formatFlowGreek(row.thetaFlow)}</td>
                  <td>{formatFlowLabel(row.confidence)}</td>
                  <td>{row.diagnostics.join(", ") || "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="experimentalFlowTableEmpty" colSpan={12}>
                  Waiting for previous snapshot
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
