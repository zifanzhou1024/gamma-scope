"use client";

import React from "react";
import type {
  HeatmapNodes,
  HeatmapOiBaselineStatus,
  HeatmapPersistenceStatus,
  HeatmapPositionMode
} from "../lib/clientHeatmapSource";
import { compactNodeLabel } from "../lib/heatmapFormat";

interface HeatmapNodePanelProps {
  nodes: HeatmapNodes;
  positionMode: HeatmapPositionMode;
  oiBaselineStatus: HeatmapOiBaselineStatus;
  persistenceStatus: HeatmapPersistenceStatus;
}

const nodeLabels: Array<{ key: keyof HeatmapNodes; label: string }> = [
  { key: "king", label: "King" },
  { key: "positiveKing", label: "Positive king" },
  { key: "negativeKing", label: "Negative king" },
  { key: "aboveWall", label: "Above wall" },
  { key: "belowWall", label: "Below wall" }
];

export function HeatmapNodePanel({
  nodes,
  positionMode,
  oiBaselineStatus,
  persistenceStatus
}: HeatmapNodePanelProps) {
  return (
    <aside className="heatmapNodePanel" aria-label="Heatmap nodes">
      <div className="heatmapNodeGrid">
        {nodeLabels.map((node) => (
          <div key={node.key} className="heatmapNodeBadge">
            <span>{node.label}</span>
            <strong>{compactNodeLabel(nodes[node.key])}</strong>
          </div>
        ))}
      </div>
      <div className="heatmapDisclosures" aria-label="Heatmap disclosures">
        {positionMode === "oi_proxy" ? <p>Open interest is an intraday proxy for exposure weighting.</p> : null}
        {oiBaselineStatus === "provisional" ? (
          <p className="heatmapWarning">Provisional baseline: opening OI capture is not locked yet.</p>
        ) : (
          <p>Baseline locked.</p>
        )}
        {persistenceStatus === "unavailable" || persistenceStatus === "skipped" ? (
          <p className="heatmapWarning">Persistence {persistenceStatus}: latest ladder may not be archived.</p>
        ) : null}
      </div>
    </aside>
  );
}
