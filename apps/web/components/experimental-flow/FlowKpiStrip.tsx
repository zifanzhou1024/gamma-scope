import React from "react";
import type { ExperimentalFlow } from "../../lib/contracts";
import {
  formatFlowCount,
  formatFlowGreek,
  formatFlowLabel,
  formatFlowPremium,
  formatSignedFlow
} from "./format";

interface FlowKpiStripProps {
  flow: ExperimentalFlow;
}

export function FlowKpiStrip({ flow }: FlowKpiStripProps) {
  return (
    <section className="experimentalFlowKpiGrid" aria-label="Experimental flow metrics">
      <FlowMetric label="Estimated buy" value={formatFlowCount(flow.summary.estimatedBuyContracts)} tone="positive" />
      <FlowMetric label="Estimated sell" value={formatFlowCount(flow.summary.estimatedSellContracts)} tone="negative" />
      <FlowMetric label="Net contracts" value={formatSignedFlow(flow.summary.netEstimatedContracts)} />
      <FlowMetric label="Net premium flow" value={formatFlowPremium(flow.summary.netPremiumFlow)} />
      <FlowMetric label="Dealer gamma pressure" value={formatFlowGreek(flow.summary.estimatedDealerGammaPressure)} />
      <FlowMetric label="Confidence" value={formatFlowLabel(flow.summary.confidence)} />
    </section>
  );
}

function FlowMetric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className={`experimentalFlowMetric${tone ? ` experimentalFlowMetric-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
