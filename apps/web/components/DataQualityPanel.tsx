import React from "react";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { CollectorHealth } from "../lib/clientCollectorStatusSource";
import {
  type DashboardSurface,
  type LiveTransportStatus,
  deriveDataQuality,
  formatInteger
} from "../lib/dashboardMetrics";

interface DataQualityPanelProps {
  snapshot: AnalyticsSnapshot;
  collectorHealth?: CollectorHealth | null;
  transportStatus?: LiveTransportStatus | null;
  activeDashboard: DashboardSurface;
}

export function DataQualityPanel({
  snapshot,
  collectorHealth,
  transportStatus,
  activeDashboard
}: DataQualityPanelProps) {
  const quality = deriveDataQuality(snapshot, collectorHealth, transportStatus, activeDashboard);
  const summary = quality.qualitySummary;

  return (
    <section className="dataQualityPanel" aria-label="Data quality">
      <div className="dataQualityGrid">
        <DataQualityItem label="Mode" value={quality.mode.label} detail={quality.mode.detail} tone={quality.mode.tone} />
        <DataQualityItem label="Updated" value={quality.lastUpdated} detail="New York market time" />
        <DataQualityItem label="Expiry" value={quality.expiry} detail={quality.zeroDteLabel} tone={quality.isZeroDte ? "ok" : "muted"} />
        <DataQualityItem
          label="Chain"
          value={`${formatInteger(quality.rowCount)} rows`}
          detail={`${formatInteger(quality.distinctStrikeCount)} strikes`}
        />
        <DataQualityItem label="Freshness" value={quality.freshness.label} tone={quality.freshness.tone} />
        <DataQualityItem label="Source" value={quality.source.label} tone={quality.source.tone} />
        <DataQualityItem label="Coverage" value={quality.coverage.label} tone={quality.coverage.tone} />
        {quality.transport ? (
          <DataQualityItem label="Transport" value={quality.transport.label} tone={quality.transport.tone} />
        ) : null}
        {quality.collector ? (
          <DataQualityItem
            label="Collector"
            value={quality.collector.label}
            detail={quality.collector.detail}
            tone={quality.collector.tone}
          />
        ) : null}
      </div>
      <div className="dataQualitySummary" aria-label="Filter quality summary">
        <span>Valid {formatInteger(summary.validQuoteRows)}</span>
        <span>Crossed {formatInteger(summary.crossedQuoteRows)}</span>
        <span>Missing bid/ask {formatInteger(summary.missingBidAskRows)}</span>
        <span>Calc issues {formatInteger(summary.nonOkCalcRows)}</span>
      </div>
    </section>
  );
}

function DataQualityItem({
  label,
  value,
  detail,
  tone = "muted"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "ok" | "warning" | "error" | "muted";
}) {
  return (
    <div className={`dataQualityItem dataQualityItem-${tone}`}>
      <span className="dataQualityLabel">{label}</span>
      <strong className="dataQualityValue">{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
