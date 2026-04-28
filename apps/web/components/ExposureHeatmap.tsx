"use client";

import React, { useMemo, useRef, useState } from "react";
import type { HeatmapMetric, HeatmapPayload, HeatmapRow } from "../lib/clientHeatmapSource";
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
}

export function ExposureHeatmap({ initialPayload }: ExposureHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>(initialPayload?.metric ?? "gex");
  const [strikeRange, setStrikeRange] = useState(40);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  const rows = useMemo(() => {
    if (!initialPayload) {
      return [];
    }

    return visibleRows(initialPayload.rows, initialPayload.spot, strikeRange).map((row) => displayRow(row, metric));
  }, [initialPayload, metric, strikeRange]);

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
        <section className="heatmapEmpty">Loading latest heatmap ladder.</section>
      </main>
    );
  }

  const nearestSpotRow = nearestRow(rows, initialPayload.spot);
  const kingStrike = initialPayload.nodes.king?.strike ?? null;

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
        onCenterKing={() => scrollToStrike(kingStrike, rowRefs.current)}
      />

      <section className="heatmapLayout" aria-label="Latest strike ladder">
        <div className="heatmapTableWrap">
          <table className="heatmapTable">
            <thead>
              <tr>
                <th>Strike</th>
                <th>Net {metric.toUpperCase()}</th>
                <th>Call {metric.toUpperCase()}</th>
                <th>Put {metric.toUpperCase()}</th>
                <th>Nodes</th>
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
                  <td className={`heatmapCell ${exposureToneClass(row.displayValue, row.displayColorNorm)}`}>
                    {row.displayFormattedValue}
                  </td>
                  <td>{formatCompactCurrency(row.displayCallValue)}</td>
                  <td>{formatCompactCurrency(row.displayPutValue)}</td>
                  <td>
                    <div className="heatmapRowTags">
                      {row.tags.map((tag) => (
                        <span key={tag}>{formatTag(tag)}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HeatmapNodePanel
          nodes={initialPayload.nodes}
          positionMode={initialPayload.positionMode}
          oiBaselineStatus={initialPayload.oiBaselineStatus}
          persistenceStatus={initialPayload.persistenceStatus}
        />
      </section>
    </main>
  );
}

function displayRow(row: HeatmapRow, metric: HeatmapMetric): DisplayRow {
  if (metric === "vex") {
    return {
      ...row,
      displayValue: row.vex,
      displayFormattedValue: formatCompactCurrency(row.vex),
      displayCallValue: row.callVex,
      displayPutValue: row.putVex,
      displayColorNorm: row.colorNormVex
    };
  }

  return {
    ...row,
    displayValue: row.gex,
    displayFormattedValue: row.formattedValue,
    displayCallValue: row.callGex,
    displayPutValue: row.putGex,
    displayColorNorm: row.colorNormGex
  };
}

function visibleRows(rows: HeatmapRow[], spot: number, strikeRange: number): HeatmapRow[] {
  const sortedRows = [...rows].sort((first, second) => first.strike - second.strike);
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
