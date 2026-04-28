"use client";

import React from "react";
import type { HeatmapMetric } from "../lib/clientHeatmapSource";

interface HeatmapToolbarProps {
  metric: HeatmapMetric;
  strikeRange: number;
  onMetricChange: (metric: HeatmapMetric) => void;
  onStrikeRangeChange: (value: number) => void;
  onCenterSpot: () => void;
  onCenterKing: () => void;
}

export function HeatmapToolbar({
  metric,
  strikeRange,
  onMetricChange,
  onStrikeRangeChange,
  onCenterSpot,
  onCenterKing
}: HeatmapToolbarProps) {
  return (
    <div className="heatmapToolbar" aria-label="Heatmap controls">
      <div className="heatmapSegmented" aria-label="Exposure metric">
        <button
          type="button"
          className={metric === "gex" ? "heatmapSegmented-active" : ""}
          aria-pressed={metric === "gex"}
          onClick={() => onMetricChange("gex")}
        >
          GEX
        </button>
        <button
          type="button"
          className={metric === "vex" ? "heatmapSegmented-active" : ""}
          aria-pressed={metric === "vex"}
          onClick={() => onMetricChange("vex")}
        >
          VEX
        </button>
      </div>
      <button type="button" className="heatmapToolButton" onClick={onCenterSpot}>
        Center spot
      </button>
      <button type="button" className="heatmapToolButton" onClick={onCenterKing}>
        Center king
      </button>
      <label className="heatmapRangeControl">
        <span>Strike range</span>
        <input
          type="range"
          min="3"
          max="80"
          step="1"
          value={strikeRange}
          onChange={(event) => onStrikeRangeChange(Number(event.currentTarget.value))}
        />
        <strong>{strikeRange}</strong>
      </label>
    </div>
  );
}
