import React from "react";
import { ExperimentalPanel } from "./ExperimentalPanel";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatNumber, formatPercent, formatPrice } from "../../lib/dashboardMetrics";

interface ExperimentalSummaryPanelsProps {
  analytics: ExperimentalAnalytics;
}

export function ExperimentalSummaryPanels({ analytics }: ExperimentalSummaryPanelsProps) {
  const forward = analytics.forwardSummary;
  const quoteQuality = analytics.quoteQuality;

  return (
    <>
      <section className="experimentalKpiGrid" aria-label="Experimental KPI strip">
        <ExperimentalMetric label="Parity forward" value={formatPrice(forward.parityForward)} />
        <ExperimentalMetric label="Forward-minus-spot" value={formatSignedPrice(forward.forwardMinusSpot)} />
        <ExperimentalMetric label="ATM straddle" value={formatPrice(forward.atmStraddle)} />
        <ExperimentalMetric label="Expected range" value={formatExpectedRange(forward.expectedRange)} />
        <ExperimentalMetric label="Expected move" value={formatPercent(forward.expectedMovePercent, 2)} />
        <ExperimentalMetric label="Quote quality" value={formatPercent(quoteQuality.score, 1)} />
      </section>

      <section className="experimentalSummaryGrid" aria-label="Experimental diagnostics summary">
        <ExperimentalPanel
          title="Forward panel"
          description={forward.label}
          status={forward.status}
          diagnostics={forward.diagnostics}
        >
          <div className="experimentalDetailGrid">
            <ExperimentalDetail label="Source spot" value={formatPrice(analytics.sourceSnapshot.spot)} />
            <ExperimentalDetail label="Source forward" value={formatPrice(analytics.sourceSnapshot.forward)} />
            <ExperimentalDetail label="ATM strike" value={formatPrice(forward.atmStrike)} />
            <ExperimentalDetail label="TTE years" value={formatNumber(analytics.sourceSnapshot.timeToExpiryYears, 6)} />
          </div>
        </ExperimentalPanel>

        <ExperimentalPanel
          title="Smile diagnostics"
          description={analytics.smileDiagnostics.label}
          status={analytics.smileDiagnostics.status}
          diagnostics={analytics.smileDiagnostics.diagnostics}
        >
          <div className="experimentalDetailGrid">
            <ExperimentalDetail
              label={analytics.smileDiagnostics.ivValley.label ?? "IV valley"}
              value={formatStrikeValue(analytics.smileDiagnostics.ivValley)}
            />
            <ExperimentalDetail label="ATM forward IV" value={formatPercent(analytics.smileDiagnostics.atmForwardIv, 2)} />
            <ExperimentalDetail label="Skew slope" value={formatNumber(analytics.smileDiagnostics.skewSlope, 3)} />
            <ExperimentalDetail label="Curvature" value={formatNumber(analytics.smileDiagnostics.curvature, 3)} />
            <ExperimentalDetail label="Method disagreement" value={formatPercent(analytics.smileDiagnostics.methodDisagreement, 2)} />
          </div>
        </ExperimentalPanel>

        <ExperimentalPanel
          title="Skew and tail asymmetry"
          description={analytics.skewTail.label}
          status={analytics.skewTail.status}
          diagnostics={analytics.skewTail.diagnostics}
        >
          <div className="experimentalDetailGrid">
            <ExperimentalDetail label="Tail bias" value={analytics.skewTail.tailBias ?? "-"} />
            <ExperimentalDetail label="Left richness" value={formatNumber(analytics.skewTail.leftTailRichness, 2)} />
            <ExperimentalDetail label="Right richness" value={formatNumber(analytics.skewTail.rightTailRichness, 2)} />
            <ExperimentalDetail label="Left tail prob" value={formatPercent(analytics.terminalDistribution.leftTailProbability, 2)} />
            <ExperimentalDetail label="Right tail prob" value={formatPercent(analytics.terminalDistribution.rightTailProbability, 2)} />
          </div>
        </ExperimentalPanel>
      </section>
    </>
  );
}

function ExperimentalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="experimentalMetric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ExperimentalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="experimentalDetail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatExpectedRange(range: ExperimentalAnalytics["forwardSummary"]["expectedRange"]): string {
  if (!range) {
    return "-";
  }
  return `${formatPrice(range.lower)} - ${formatPrice(range.upper)}`;
}

function formatSignedPrice(value: number | null): string {
  if (value == null) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPrice(value)}`;
}

function formatStrikeValue(strikeValue: ExperimentalAnalytics["smileDiagnostics"]["ivValley"]): string {
  if (strikeValue.strike == null || strikeValue.value == null) {
    return "-";
  }
  return `${formatPrice(strikeValue.strike)} / ${formatPercent(strikeValue.value, 2)}`;
}
