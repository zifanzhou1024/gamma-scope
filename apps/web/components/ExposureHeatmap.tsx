"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HeatmapMetric, HeatmapNodes, HeatmapPayload, HeatmapRow } from "../lib/clientHeatmapSource";
import { exposureToneClass, formatHeatmapStatus, formatHeatmapTime } from "../lib/heatmapFormat";
import { HeatmapNodePanel } from "./HeatmapNodePanel";
import { HeatmapToolbar } from "./HeatmapToolbar";

interface ExposureHeatmapProps {
  initialPayload: HeatmapPayload | null;
}

interface DisplayRow extends HeatmapRow {
  displayValue: number;
  displayFormattedValue: string;
  displayCallValue: number;
  displayPutValue: number;
  displayColorNorm: number;
  displayTags: string[];
}

const NODE_TAGS = new Set(["king", "positive_king", "negative_king", "above_wall", "below_wall"]);

export function ExposureHeatmap({ initialPayload }: ExposureHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>(initialPayload?.metric ?? "gex");
  const [strikeRange, setStrikeRange] = useState(40);
  const [renderAllRows, setRenderAllRows] = useState(false);
  const [pendingScrollStrike, setPendingScrollStrike] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  const activeNodes = useMemo(() => {
    if (!initialPayload) {
      return null;
    }

    return deriveMetricNodes(initialPayload.rows, initialPayload.spot, metric);
  }, [initialPayload, metric]);

  const rows = useMemo(() => {
    if (!initialPayload) {
      return [];
    }

    return visibleRows(initialPayload.rows, initialPayload.spot, strikeRange, renderAllRows).map((row) =>
      displayRow(row, metric, activeNodes)
    );
  }, [activeNodes, initialPayload, metric, renderAllRows, strikeRange]);

  useLayoutEffect(() => {
    if (pendingScrollStrike === null) {
      return;
    }

    scrollToStrike(pendingScrollStrike, rowRefs.current);
    setPendingScrollStrike(null);
  }, [pendingScrollStrike, rows]);

  if (!initialPayload) {
    return (
      <main className="dashboardShell heatmapShell">
        <header className="topBar">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE heatmap</p>
            </div>
          </div>
        </header>
        <section className="heatmapEmpty">No heatmap snapshot is available.</section>
      </main>
    );
  }

  const nearestSpotRow = nearestRow(rows, initialPayload.spot);
  const kingStrike = activeNodes?.king?.strike ?? null;

  return (
    <main className="dashboardShell heatmapShell">
      <header className="topBar heatmapHeader">
        <div className="topBarPrimary">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE heatmap</p>
            </div>
          </div>
          <nav className="topNavTabs" aria-label="Dashboard views">
            <a className="topNavTab" href="/">
              Realtime
            </a>
            <a className="topNavTab" href="/replay">
              Replay
            </a>
            <a className="topNavTab topNavTab-active" href="/heatmap" aria-current="page">
              Heatmap
            </a>
          </nav>
        </div>
        <div className="heatmapHeaderStats" aria-label="Heatmap status">
          <span>{initialPayload.tradingClass}</span>
          <span>Spot {formatNumber(initialPayload.spot, 2)}</span>
          <span>{formatHeatmapStatus(initialPayload)}</span>
          <span>Last synced {formatHeatmapTime(initialPayload.lastSyncedAt)}</span>
        </div>
      </header>

      <HeatmapToolbar
        metric={metric}
        strikeRange={strikeRange}
        onMetricChange={setMetric}
        onStrikeRangeChange={setStrikeRange}
        onCenterSpot={() => scrollToStrike(nearestSpotRow?.strike ?? null, rowRefs.current)}
        onCenterKing={() => {
          setRenderAllRows(true);
          setPendingScrollStrike(kingStrike);
        }}
      />

      <section className="heatmapLayout" aria-label="Latest strike ladder">
        <div className="heatmapTableWrap">
          <table className="heatmapTable">
            <thead>
              <tr>
                <th>Strike</th>
                <th>{metric.toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.strike}
                  ref={(element) => setRowRef(rowRefs.current, row.strike, element)}
                  data-heatmap-row={row.strike}
                  className={row.strike === nearestSpotRow?.strike ? "heatmapSpotRow" : undefined}
                >
                  <td className="heatmapStrike">
                    <strong>{formatNumber(row.strike, Number.isInteger(row.strike) ? 0 : 2)}</strong>
                    {row.strike === nearestSpotRow?.strike ? <span>Spot</span> : null}
                  </td>
                  <td
                    className={`heatmapCell ${exposureToneClass(row.displayValue, row.displayColorNorm)}`}
                    title={componentTooltip(row, metric)}
                    aria-label={componentTooltip(row, metric)}
                  >
                    <div className="heatmapCellInner">
                      <div className="heatmapRowTags">
                        {row.displayTags.map((tag) => (
                          <span key={tag}>{formatTag(tag)}</span>
                        ))}
                      </div>
                      <strong>{row.displayFormattedValue}</strong>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HeatmapNodePanel
          nodes={activeNodes ?? initialPayload.nodes}
          positionMode={initialPayload.positionMode}
          oiBaselineStatus={initialPayload.oiBaselineStatus}
          persistenceStatus={initialPayload.persistenceStatus}
        />
      </section>
    </main>
  );
}

function displayRow(row: HeatmapRow, metric: HeatmapMetric, nodes: HeatmapNodes | null): DisplayRow {
  if (metric === "vex") {
    return {
      ...row,
      displayValue: row.vex,
      displayFormattedValue: formatCompactCurrency(row.vex),
      displayCallValue: row.callVex,
      displayPutValue: row.putVex,
      displayColorNorm: row.colorNormVex,
      displayTags: displayTagsForMetric(row, nodes)
    };
  }

  return {
    ...row,
    displayValue: row.gex,
    displayFormattedValue: row.formattedValue,
    displayCallValue: row.callGex,
    displayPutValue: row.putGex,
    displayColorNorm: row.colorNormGex,
    displayTags: displayTagsForMetric(row, nodes)
  };
}

function componentTooltip(row: DisplayRow, metric: HeatmapMetric): string {
  const label = metric.toUpperCase();

  return [
    `Net ${label}: ${row.displayFormattedValue}`,
    `Call ${label}: ${formatCompactCurrency(row.displayCallValue)}`,
    `Put ${label}: ${formatCompactCurrency(row.displayPutValue)}`
  ].join("\n");
}

function displayTagsForMetric(row: HeatmapRow, nodes: HeatmapNodes | null): string[] {
  const qualityTags = row.tags.filter((tag) => !NODE_TAGS.has(tag));

  return [...qualityTags, ...deriveMetricTags(row.strike, nodes)];
}

function visibleRows(rows: HeatmapRow[], spot: number, strikeRange: number, renderAllRows: boolean): HeatmapRow[] {
  const sortedRows = [...rows].sort((first, second) => first.strike - second.strike);

  if (renderAllRows) {
    return sortedRows;
  }

  const nearestIndex = sortedRows.reduce((bestIndex, row, index) => {
    const best = sortedRows[bestIndex];
    return Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? index : bestIndex;
  }, 0);
  const start = Math.max(0, nearestIndex - strikeRange);
  const end = Math.min(sortedRows.length, nearestIndex + strikeRange + 1);
  return sortedRows.slice(start, end);
}

function nearestRow(rows: HeatmapRow[], spot: number): HeatmapRow | null {
  return rows.reduce<HeatmapRow | null>((nearest, row) => {
    if (!nearest) {
      return row;
    }

    return Math.abs(row.strike - spot) < Math.abs(nearest.strike - spot) ? row : nearest;
  }, null);
}

function setRowRef(refs: Map<number, HTMLTableRowElement>, strike: number, element: HTMLTableRowElement | null) {
  if (element) {
    refs.set(strike, element);
  } else {
    refs.delete(strike);
  }
}

function scrollToStrike(strike: number | null, refs: Map<number, HTMLTableRowElement>) {
  if (strike === null) {
    return;
  }

  refs.get(strike)?.scrollIntoView({ block: "center", inline: "nearest" });
}

function deriveMetricNodes(rows: HeatmapRow[], spot: number, metric: HeatmapMetric): HeatmapNodes {
  const metricRows = rows
    .map((row) => ({
      row,
      value: metric === "gex" ? row.gex : row.vex
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0);
  const wallThreshold = percentile80(metricRows.map((entry) => Math.abs(entry.value)));
  const king = maxBy(metricRows, (entry) => Math.abs(entry.value));
  const positiveKing = maxBy(metricRows.filter((entry) => entry.value > 0), (entry) => entry.value);
  const negativeKing = minBy(metricRows.filter((entry) => entry.value < 0), (entry) => entry.value);
  const aboveWall = closestByStrikeDistance(
    metricRows.filter((entry) => entry.row.strike > spot && Math.abs(entry.value) >= wallThreshold),
    spot
  );
  const belowWall = closestByStrikeDistance(
    metricRows.filter((entry) => entry.row.strike < spot && Math.abs(entry.value) >= wallThreshold),
    spot
  );

  return {
    king: toNode(king),
    positiveKing: toNode(positiveKing),
    negativeKing: toNode(negativeKing),
    aboveWall: toNode(aboveWall),
    belowWall: toNode(belowWall)
  };
}

function percentile80(values: number[]): number {
  if (values.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const sortedValues = [...values].sort((first, second) => first - second);
  const rank = (sortedValues.length - 1) * 0.8;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = rank - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

function deriveMetricTags(strike: number, nodes: HeatmapNodes | null): string[] {
  if (!nodes) {
    return [];
  }

  const tags: string[] = [];

  if (nodes.king?.strike === strike) {
    tags.push("king");
  }

  if (nodes.positiveKing?.strike === strike) {
    tags.push("positive_king");
  }

  if (nodes.negativeKing?.strike === strike) {
    tags.push("negative_king");
  }

  if (nodes.aboveWall?.strike === strike) {
    tags.push("above_wall");
  }

  if (nodes.belowWall?.strike === strike) {
    tags.push("below_wall");
  }

  return tags;
}

type MetricEntry = {
  row: HeatmapRow;
  value: number;
};

function toNode(entry: MetricEntry | null) {
  return entry ? { strike: entry.row.strike, value: entry.value } : null;
}

function maxBy(entries: MetricEntry[], score: (entry: MetricEntry) => number): MetricEntry | null {
  return entries.reduce<MetricEntry | null>((best, entry) => {
    if (!best || score(entry) > score(best)) {
      return entry;
    }

    return best;
  }, null);
}

function minBy(entries: MetricEntry[], score: (entry: MetricEntry) => number): MetricEntry | null {
  return entries.reduce<MetricEntry | null>((best, entry) => {
    if (!best || score(entry) < score(best)) {
      return entry;
    }

    return best;
  }, null);
}

function closestByStrikeDistance(entries: MetricEntry[], spot: number): MetricEntry | null {
  return entries.reduce<MetricEntry | null>((best, entry) => {
    if (!best || Math.abs(entry.row.strike - spot) < Math.abs(best.row.strike - spot)) {
      return entry;
    }

    return best;
  }, null);
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000_000_000)}B`;
  }

  if (absoluteValue >= 1_000_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000_000)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000)}K`;
  }

  return `${sign}$${trimTrailingZero(absoluteValue)}`;
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatTag(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
