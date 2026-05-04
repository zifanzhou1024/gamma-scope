import React from "react";
import type { ExperimentalFlow } from "../../lib/contracts";
import {
  formatFlowCount,
  formatFlowGreek,
  formatFlowLabel,
  formatFlowPremium,
  formatFlowStrike
} from "./format";

interface FlowStrikeLadderProps {
  rows: ExperimentalFlow["strikeRows"];
}

export function FlowStrikeLadder({ rows }: FlowStrikeLadderProps) {
  return (
    <section className="experimentalFlowPanel experimentalFlowStrikeLadder" aria-label="Flow strike ladder">
      <div className="experimentalFlowPanelHeader">
        <div>
          <h2>Flow strike ladder</h2>
          <p>Estimated flow deltas by strike from current versus previous snapshot.</p>
        </div>
      </div>
      <div className="experimentalFlowTableWrap">
        <table className="experimentalFlowTable">
          <thead>
            <tr>
              <th>Strike</th>
              <th>Call buy</th>
              <th>Call sell</th>
              <th>Put buy</th>
              <th>Put sell</th>
              <th>Premium</th>
              <th>Dealer gamma</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.strike}>
                  <td>{formatFlowStrike(row.strike)}</td>
                  <td>{formatFlowCount(row.callBuyContracts)}</td>
                  <td>{formatFlowCount(row.callSellContracts)}</td>
                  <td>{formatFlowCount(row.putBuyContracts)}</td>
                  <td>{formatFlowCount(row.putSellContracts)}</td>
                  <td>{formatFlowPremium(row.netPremiumFlow)}</td>
                  <td>{formatFlowGreek(row.estimatedDealerGammaPressure)}</td>
                  <td>{formatFlowLabel(row.confidence)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="experimentalFlowTableEmpty" colSpan={8}>
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
