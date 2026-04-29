"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HeatmapMetric, HeatmapNodes, HeatmapPayload, HeatmapRow, HeatmapSymbol } from "../lib/clientHeatmapSource";
import { exposureToneClass, formatHeatmapStatus, formatHeatmapTime } from "../lib/heatmapFormat";
import { HeatmapNodePanel } from "./HeatmapNodePanel";
import { HeatmapToolbar } from "./HeatmapToolbar";
import { ThemeToggle } from "./ThemeToggle";

interface ExposureHeatmapProps {
  initialPayload?: HeatmapPayload | null;
  initialPayloads?: HeatmapPayload[];
}

interface DisplayRow extends HeatmapRow {
  displayValue: number;
  displayFormattedValue: string;
  displayCallValue: number;
  displayPutValue: number;
  displayColorNorm: number;
  displayTags: string[];
}

interface HeatmapPanelModel {
  payload: HeatmapPayload;
  activeNodes: HeatmapNodes;
  rows: DisplayRow[];
  nearestSpotRow: DisplayRow | null;
}

type HeatmapPanelsStyle = React.CSSProperties & {
  "--heatmap-column-count": number;
};

const NODE_TAGS = new Set(["king", "positive_king", "negative_king", "above_wall", "below_wall"]);
const DEFAULT_VISIBLE_SYMBOLS: HeatmapSymbol[] = ["SPX", "SPY", "QQQ"];
const MAX_VISIBLE_PANELS = 6;

export function ExposureHeatmap({ initialPayload, initialPayloads }: ExposureHeatmapProps) {
  const payloads = useMemo(() => {
    if (initialPayloads) {
      return initialPayloads;
    }
    return initialPayload ? [initialPayload] : [];
  }, [initialPayload, initialPayloads]);
  const payloadBySymbol = useMemo(() => new Map(payloads.map((payload) => [payload.symbol, payload])), [payloads]);
  const [selectedSymbols, setSelectedSymbols] = useState<HeatmapSymbol[]>(() => defaultSelectedSymbols(payloads));
  const selectedPayloads = useMemo(
    () => selectedSymbols.map((symbol) => payloadBySymbol.get(symbol)).filter((payload): payload is HeatmapPayload => Boolean(payload)),
    [payloadBySymbol, selectedSymbols]
  );
  const primaryPayload = selectedPayloads[0] ?? payloads[0] ?? null;
  const [metric, setMetric] = useState<HeatmapMetric>(primaryPayload?.metric ?? "gex");
  const [strikeRange, setStrikeRange] = useState(40);
  const [renderAllRows, setRenderAllRows] = useState(false);
  const [pendingScrollRows, setPendingScrollRows] = useState<string[]>([]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const panelModels = useMemo(
    () => selectedPayloads.map((payload) => panelModel(payload, metric, strikeRange, renderAllRows)),
    [metric, selectedPayloads, renderAllRows, strikeRange]
  );
  const panelColumnCount = Math.min(Math.max(panelModels.length, 1), MAX_VISIBLE_PANELS);

  useLayoutEffect(() => {
    if (pendingScrollRows.length === 0) {
      return;
    }

    pendingScrollRows.forEach((rowKey) => scrollToRow(rowKey, rowRefs.current));
    setPendingScrollRows([]);
  }, [pendingScrollRows, panelModels]);

  if (!primaryPayload) {
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
            <HeatmapNavTabs />
          </div>
          <div className="topBarUtility heatmapHeaderUtility">
            <ThemeToggle />
          </div>
        </header>
        <section className="heatmapEmpty">No heatmap snapshot is available.</section>
      </main>
    );
  }

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
          <HeatmapNavTabs />
        </div>
        <div className="topBarUtility heatmapHeaderUtility">
          <ThemeToggle />
          <div className="heatmapHeaderStats" aria-label="Heatmap status">
            <span>{selectedPayloads.map((payload) => payload.tradingClass).join(" / ")}</span>
            <span>{formatHeatmapStatus(primaryPayload)}</span>
            <span>Last synced {formatHeatmapTime(primaryPayload.lastSyncedAt)}</span>
          </div>
        </div>
      </header>

      <HeatmapToolbar
        metric={metric}
        strikeRange={strikeRange}
        onMetricChange={setMetric}
        onStrikeRangeChange={setStrikeRange}
        onCenterSpot={() =>
          panelModels.forEach((model) => scrollToRow(rowKey(model.payload, model.nearestSpotRow?.strike ?? null), rowRefs.current))
        }
        onCenterKing={() => {
          setRenderAllRows(true);
          setPendingScrollRows(
            panelModels
              .map((model) => rowKey(model.payload, model.activeNodes.king?.strike ?? null))
              .filter((key): key is string => key !== null)
          );
        }}
      />

      <HeatmapTickerControls
        payloads={payloads}
        selectedSymbols={selectedSymbols}
        onToggleSymbol={(symbol) => setSelectedSymbols((current) => toggleSymbol(current, symbol))}
        onMoveSymbol={(symbol, direction) => setSelectedSymbols((current) => moveSymbol(current, symbol, direction))}
      />

      <section
        className="heatmapPanels"
        aria-label="Latest strike ladders"
        data-column-count={panelColumnCount}
        style={{ "--heatmap-column-count": panelColumnCount } as HeatmapPanelsStyle}
      >
        {panelModels.map((model) => (
          <HeatmapPanel
            key={model.payload.symbol}
            model={model}
            metric={metric}
            rowRefs={rowRefs.current}
          />
        ))}
      </section>
    </main>
  );
}

function HeatmapNavTabs() {
  return (
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
      <a className="topNavTab" href="/experimental">
        Experimental
      </a>
    </nav>
  );
}

function HeatmapTickerControls({
  payloads,
  selectedSymbols,
  onToggleSymbol,
  onMoveSymbol
}: {
  payloads: HeatmapPayload[];
  selectedSymbols: HeatmapSymbol[];
  onToggleSymbol: (symbol: HeatmapSymbol) => void;
  onMoveSymbol: (symbol: HeatmapSymbol, direction: -1 | 1) => void;
}) {
  if (payloads.length <= 1) {
    return null;
  }

  const selectedSet = new Set(selectedSymbols);

  return (
    <section className="heatmapTickerControls" aria-label="Ticker selection">
      <div className="heatmapTickerGroup">
        <span>Tickers</span>
        <div className="heatmapTickerButtons">
          {payloads.map((payload) => {
            const selected = selectedSet.has(payload.symbol);
            return (
              <button
                key={payload.symbol}
                type="button"
                aria-pressed={selected}
                disabled={!selected && selectedSymbols.length >= MAX_VISIBLE_PANELS}
                onClick={() => onToggleSymbol(payload.symbol)}
              >
                {payload.symbol}
              </button>
            );
          })}
        </div>
      </div>
      <div className="heatmapTickerOrder" aria-label="Ticker order">
        {selectedSymbols.map((symbol, index) => (
          <span className="heatmapTickerOrderItem" key={symbol}>
            <strong>{symbol}</strong>
            <button
              type="button"
              aria-label={`Move ${symbol} left`}
              title={`Move ${symbol} left`}
              disabled={index === 0}
              onClick={() => onMoveSymbol(symbol, -1)}
            >
              {"<"}
            </button>
            <button
              type="button"
              aria-label={`Move ${symbol} right`}
              title={`Move ${symbol} right`}
              disabled={index === selectedSymbols.length - 1}
              onClick={() => onMoveSymbol(symbol, 1)}
            >
              {">"}
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function HeatmapPanel({
  model,
  metric,
  rowRefs
}: {
  model: HeatmapPanelModel;
  metric: HeatmapMetric;
  rowRefs: Map<string, HTMLTableRowElement>;
}) {
  const king = model.activeNodes.king;

  return (
    <article className="heatmapPanel" aria-label={`${model.payload.symbol} heatmap`}>
      <header className="heatmapPanelHeader">
        <button className="heatmapPanelSymbol" type="button">
          {model.payload.tradingClass}
        </button>
        <div className="heatmapPanelSpot">
          <strong>{formatPanelSpot(model.payload)}</strong>
          <span>{formatHeatmapStatus(model.payload)}</span>
        </div>
      </header>
      <div className="heatmapPanelKing">
        <span aria-hidden="true" />
        <strong>King</strong>
        <em>{king ? `${formatNumber(king.strike, Number.isInteger(king.strike) ? 0 : 2)} ${formatCompactCurrency(king.value)}` : "-"}</em>
      </div>
      <div className="heatmapTableWrap">
        <table className="heatmapTable">
          <thead>
            <tr>
              <th>Strike</th>
              <th>{metric.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.length === 0 ? (
              <tr>
                <td className="heatmapUnavailableRow" colSpan={2}>
                  No snapshot
                </td>
              </tr>
            ) : null}
            {model.rows.map((row) => (
              <HeatmapRowView
                key={row.strike}
                row={row}
                model={model}
                metric={metric}
                rowRefs={rowRefs}
              />
            ))}
          </tbody>
        </table>
      </div>
      <HeatmapNodePanel
        nodes={model.activeNodes}
        positionMode={model.payload.positionMode}
        oiBaselineStatus={model.payload.oiBaselineStatus}
        persistenceStatus={model.payload.persistenceStatus}
      />
    </article>
  );
}

function HeatmapRowView({
  row,
  model,
  metric,
  rowRefs
}: {
  row: DisplayRow;
  model: HeatmapPanelModel;
  metric: HeatmapMetric;
  rowRefs: Map<string, HTMLTableRowElement>;
}) {
  const isSpotRow = row.strike === model.nearestSpotRow?.strike;
  const isKingRow = row.strike === model.activeNodes.king?.strike;

  return (
    <tr
      ref={(element) => setRowRef(rowRefs, rowKey(model.payload, row.strike), element)}
      data-heatmap-row={row.strike}
      className={rowClassName(isSpotRow, isKingRow)}
    >
      <td className="heatmapStrike">
        <strong>{formatNumber(row.strike, Number.isInteger(row.strike) ? 0 : 2)}</strong>
        {isSpotRow || isKingRow ? (
          <span className="heatmapRowBadges">
            {isSpotRow ? <em className="heatmapRowBadge heatmapRowBadge-spot">Spot</em> : null}
            {isKingRow ? <em className="heatmapRowBadge heatmapRowBadge-king">King</em> : null}
          </span>
        ) : null}
      </td>
      <td
        className={`heatmapCell ${exposureToneClass(row.displayValue, row.displayColorNorm)}`}
        title={componentTooltip(row, metric)}
        aria-label={componentTooltip(row, metric)}
      >
        <div className="heatmapCellInner">
          <strong>{row.displayFormattedValue}</strong>
        </div>
      </td>
    </tr>
  );
}

function panelModel(
  payload: HeatmapPayload,
  metric: HeatmapMetric,
  strikeRange: number,
  renderAllRows: boolean
): HeatmapPanelModel {
  const activeNodes = deriveMetricNodes(payload.rows, payload.spot, metric);
  const rows = visibleRows(payload.rows, payload.spot, strikeRange, renderAllRows).map((row) =>
    displayRow(row, metric, activeNodes)
  );

  return {
    payload,
    activeNodes,
    rows,
    nearestSpotRow: nearestRow(rows, payload.spot)
  };
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
  const details = [
    `Net ${label}: ${row.displayFormattedValue}`,
    `Call ${label}: ${formatCompactCurrency(row.displayCallValue)}`,
    `Put ${label}: ${formatCompactCurrency(row.displayPutValue)}`
  ];

  if (row.displayTags.length > 0) {
    details.push(`Tags: ${row.displayTags.map(formatTag).join(", ")}`);
  }

  return details.join("\n");
}

function displayTagsForMetric(row: HeatmapRow, nodes: HeatmapNodes | null): string[] {
  const qualityTags = row.tags.filter((tag) => !NODE_TAGS.has(tag));

  return [...qualityTags, ...deriveMetricTags(row.strike, nodes)];
}

function visibleRows(rows: HeatmapRow[], spot: number, strikeRange: number, renderAllRows: boolean): HeatmapRow[] {
  const sortedRows = [...rows].sort((first, second) => second.strike - first.strike);

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

function nearestRow<Row extends HeatmapRow>(rows: Row[], spot: number): Row | null {
  return rows.reduce<Row | null>((nearest, row) => {
    if (!nearest) {
      return row;
    }

    return Math.abs(row.strike - spot) < Math.abs(nearest.strike - spot) ? row : nearest;
  }, null);
}

function defaultSelectedSymbols(payloads: HeatmapPayload[]): HeatmapSymbol[] {
  const availableSymbols = payloads.map((payload) => payload.symbol);
  const selected = DEFAULT_VISIBLE_SYMBOLS.filter((symbol) => availableSymbols.includes(symbol));

  for (const symbol of availableSymbols) {
    if (selected.length >= Math.min(3, availableSymbols.length)) {
      break;
    }
    if (!selected.includes(symbol)) {
      selected.push(symbol);
    }
  }

  return selected.slice(0, MAX_VISIBLE_PANELS);
}

function toggleSymbol(selectedSymbols: HeatmapSymbol[], symbol: HeatmapSymbol): HeatmapSymbol[] {
  if (selectedSymbols.includes(symbol)) {
    return selectedSymbols.length === 1 ? selectedSymbols : selectedSymbols.filter((selectedSymbol) => selectedSymbol !== symbol);
  }

  if (selectedSymbols.length >= MAX_VISIBLE_PANELS) {
    return selectedSymbols;
  }

  return [...selectedSymbols, symbol];
}

function moveSymbol(selectedSymbols: HeatmapSymbol[], symbol: HeatmapSymbol, direction: -1 | 1): HeatmapSymbol[] {
  const index = selectedSymbols.indexOf(symbol);
  const targetIndex = index + direction;

  if (index === -1 || targetIndex < 0 || targetIndex >= selectedSymbols.length) {
    return selectedSymbols;
  }

  const nextSymbols = [...selectedSymbols];
  [nextSymbols[index], nextSymbols[targetIndex]] = [nextSymbols[targetIndex], nextSymbols[index]];
  return nextSymbols;
}

function rowClassName(isSpotRow: boolean, isKingRow: boolean): string | undefined {
  const classNames = [];
  if (isSpotRow) {
    classNames.push("heatmapSpotRow");
  }
  if (isKingRow) {
    classNames.push("heatmapKingRow");
  }
  return classNames.length > 0 ? classNames.join(" ") : undefined;
}

function rowKey(payload: HeatmapPayload, strike: number | null): string | null {
  return strike === null ? null : `${payload.symbol}:${strike}`;
}

function setRowRef(refs: Map<string, HTMLTableRowElement>, key: string | null, element: HTMLTableRowElement | null) {
  if (key === null) {
    return;
  }
  if (element) {
    refs.set(key, element);
  } else {
    refs.delete(key);
  }
}

function scrollToRow(key: string | null, refs: Map<string, HTMLTableRowElement>) {
  if (key === null) {
    return;
  }

  refs.get(key)?.scrollIntoView({ block: "center", inline: "nearest" });
}

function formatPanelSpot(payload: HeatmapPayload): string {
  return payload.rows.length === 0 && payload.persistenceStatus === "unavailable"
    ? "-"
    : `$${formatNumber(payload.spot, 2)}`;
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
