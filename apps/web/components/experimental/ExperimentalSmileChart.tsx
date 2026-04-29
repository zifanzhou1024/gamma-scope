"use client";

import React from "react";
import { ExperimentalPanel } from "./ExperimentalPanel";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatNumber, formatPercent } from "../../lib/dashboardMetrics";

interface ExperimentalSmileChartProps {
  analytics: ExperimentalAnalytics;
}

type ChartPoint = {
  x: number;
  y: number | null;
};

type ChartDomain = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ExperimentalChartKey = "iv_smile" | "terminal_distribution";

type ActiveChartPoint = {
  chart: ExperimentalChartKey;
  seriesKey: string;
  seriesLabel: string;
  x: number;
  y: number;
  valueKind: "percent" | "decimal";
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 340;
const PLOT = {
  left: 58,
  right: 18,
  top: 20,
  bottom: 58
};
const GRID_LINE_COUNT = 4;

const SERIES_CLASSES = ["experimentalSeries-blue", "experimentalSeries-teal", "experimentalSeries-violet", "experimentalSeries-amber"];

export function ExperimentalSmileChart({ analytics }: ExperimentalSmileChartProps) {
  const [activePoint, setActivePoint] = React.useState<ActiveChartPoint | null>(null);
  const [hiddenIvMethods, setHiddenIvMethods] = React.useState<Set<string>>(() => new Set());
  const ivDomain = domainForSeries(analytics.ivSmiles.methods.flatMap((entry) => entry.points));
  const distributionDomain = domainForSeries(analytics.terminalDistribution.density);

  const toggleIvMethod = (methodKey: string) => {
    setActivePoint(null);
    setHiddenIvMethods((current) => {
      const next = new Set(current);

      if (next.has(methodKey)) {
        next.delete(methodKey);
      } else {
        next.add(methodKey);
      }

      return next;
    });
  };

  return (
    <section className="experimentalChartsGrid" aria-label="Experimental charts">
      <ExperimentalPanel
        title={analytics.ivSmiles.label}
        description="Method comparison across strike."
        status={analytics.ivSmiles.status}
        diagnostics={analytics.ivSmiles.diagnostics}
      >
        <div className="experimentalChartFrame" onMouseLeave={() => setActivePoint(null)}>
          <svg
            className="experimentalChartSvg"
            role="img"
            aria-label="IV smile methods chart"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          >
            <ChartGrid domain={ivDomain} xAxisLabel="Strike" yAxisLabel="IV (%)" yValueKind="percent" />
            {analytics.ivSmiles.methods.map((method, index) => {
              if (hiddenIvMethods.has(method.key)) {
                return null;
              }

              const className = SERIES_CLASSES[index % SERIES_CLASSES.length];
              return (
                <g key={method.key} data-experimental-series={method.key}>
                  {renderSeries(method.key, method.points, ivDomain, className)}
                  {renderPointTargets({
                    chart: "iv_smile",
                    seriesKey: method.key,
                    seriesLabel: method.label,
                    points: method.points,
                    domain: ivDomain,
                    className,
                    valueKind: "percent",
                    onInspect: setActivePoint
                  })}
                </g>
              );
            })}
          </svg>
          {activePoint?.chart === "iv_smile" ? <ExperimentalChartTooltip point={activePoint} /> : null}
        </div>
        <div className="experimentalLegend" aria-label="IV smile methods">
          {analytics.ivSmiles.methods.map((method, index) => {
            const nearestForwardIv = findNearestForwardValue(method.points, analytics.sourceSnapshot.forward);
            const lowestIvPoint = findLowestValuePoint(method.points);
            const isVisible = !hiddenIvMethods.has(method.key);

            return (
              <button
                key={method.key}
                type="button"
                className="experimentalLegendItem"
                aria-pressed={isVisible}
                data-experimental-iv-method-toggle={method.key}
                onClick={() => toggleIvMethod(method.key)}
              >
                <span className="experimentalLegendLabel">
                  <i className={SERIES_CLASSES[index % SERIES_CLASSES.length]} aria-hidden="true" />
                  {method.label}
                </span>
                <span className="experimentalLegendMetrics">
                  <strong data-experimental-iv-method-value={method.key}>
                    ATM {formatPercent(nearestForwardIv, 2)}
                  </strong>
                  <strong data-experimental-iv-method-low={method.key}>
                    Low {formatLowestPointLabel(lowestIvPoint)}
                  </strong>
                </span>
              </button>
            );
          })}
        </div>
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.terminalDistribution.label}
        description="Risk-neutral terminal density."
        status={analytics.terminalDistribution.status}
        diagnostics={analytics.terminalDistribution.diagnostics}
      >
        <div className="experimentalChartFrame" onMouseLeave={() => setActivePoint(null)}>
          <svg
            className="experimentalChartSvg"
            role="img"
            aria-label="Terminal distribution chart"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          >
            <ChartGrid domain={distributionDomain} xAxisLabel="Expiry level" yAxisLabel="Density" yValueKind="decimal" />
            {renderSeries(
              "terminal_distribution",
              analytics.terminalDistribution.density,
              distributionDomain,
              "experimentalSeries-distribution"
            )}
            {renderPointTargets({
              chart: "terminal_distribution",
              seriesKey: "terminal_distribution",
              seriesLabel: "Terminal density",
              points: analytics.terminalDistribution.density,
              domain: distributionDomain,
              className: "experimentalSeries-distribution",
              valueKind: "decimal",
              onInspect: setActivePoint
            })}
          </svg>
          {activePoint?.chart === "terminal_distribution" ? <ExperimentalChartTooltip point={activePoint} /> : null}
        </div>
        <div className="experimentalDistributionStats" aria-label="Terminal distribution summary">
          <span><strong>Highest density</strong>{analytics.terminalDistribution.highestDensityZone ?? "-"}</span>
          <span><strong>68% range</strong>{analytics.terminalDistribution.range68 ?? "-"}</span>
          <span><strong>95% range</strong>{analytics.terminalDistribution.range95 ?? "-"}</span>
          <span><strong>Left tail</strong>{formatPercent(analytics.terminalDistribution.leftTailProbability, 2)}</span>
          <span><strong>Right tail</strong>{formatPercent(analytics.terminalDistribution.rightTailProbability, 2)}</span>
        </div>
      </ExperimentalPanel>
    </section>
  );
}

function renderSeries(key: string, points: ChartPoint[], domain: ChartDomain | null, className: string) {
  if (!domain) {
    return null;
  }

  return contiguousSegments(points).map((segment, index) => {
    if (segment.length === 1) {
      const point = segment[0]!;
      return (
        <circle
          key={`${key}:${index}`}
          data-series-key={key}
          className={`experimentalSeriesMarker ${className}`}
          cx={scaleX(point.x, domain)}
          cy={scaleY(point.y ?? 0, domain)}
          r="4"
        />
      );
    }

    return (
      <polyline
        key={`${key}:${index}`}
        data-series-key={key}
        className={`experimentalSeries ${className}`}
        points={polylinePoints(segment, domain)}
        fill="none"
      />
    );
  });
}

type RenderPointTargetsOptions = {
  chart: ExperimentalChartKey;
  seriesKey: string;
  seriesLabel: string;
  points: ChartPoint[];
  domain: ChartDomain | null;
  className: string;
  valueKind: ActiveChartPoint["valueKind"];
  onInspect: (point: ActiveChartPoint | null) => void;
};

function renderPointTargets({
  chart,
  seriesKey,
  seriesLabel,
  points,
  domain,
  className,
  valueKind,
  onInspect
}: RenderPointTargetsOptions) {
  if (!domain) {
    return null;
  }

  return points
    .filter((point): point is { x: number; y: number } => point.y != null)
    .map((point, index) => {
      const activePoint = {
        chart,
        seriesKey,
        seriesLabel,
        x: point.x,
        y: point.y,
        valueKind
      };
      const label = `${seriesLabel} at ${formatStrike(point.x)}: ${formatChartValue(point.y, valueKind)}`;

      return (
        <g key={`${seriesKey}:point:${point.x}:${index}`} className="experimentalChartPointGroup">
          <circle
            className={`experimentalChartPoint ${className}`}
            cx={scaleX(point.x, domain)}
            cy={scaleY(point.y, domain)}
            r="3.4"
            aria-hidden="true"
          />
          <circle
            className="experimentalChartPointHitTarget"
            data-experimental-chart-point={`${seriesKey}:${point.x}`}
            cx={scaleX(point.x, domain)}
            cy={scaleY(point.y, domain)}
            r="10"
            tabIndex={0}
            role="button"
            aria-label={label}
            onMouseEnter={() => onInspect(activePoint)}
            onClick={() => onInspect(activePoint)}
            onFocus={() => onInspect(activePoint)}
            onBlur={() => onInspect(null)}
          />
        </g>
      );
    });
}

function ExperimentalChartTooltip({ point }: { point: ActiveChartPoint }) {
  return (
    <div
      className="experimentalChartTooltip"
      data-experimental-chart-tooltip={point.chart}
      role="status"
      aria-label={`${point.seriesLabel} point value`}
    >
      <strong>{point.seriesLabel}</strong>
      <span>Level {formatStrike(point.x)}</span>
      <span>{formatChartValue(point.y, point.valueKind)}</span>
    </div>
  );
}

function ChartGrid({
  domain,
  xAxisLabel,
  yAxisLabel,
  yValueKind
}: {
  domain: ChartDomain | null;
  xAxisLabel: string;
  yAxisLabel: string;
  yValueKind: ActiveChartPoint["valueKind"];
}) {
  const xTicks = domain ? buildTicks(domain.minX, domain.maxX, GRID_LINE_COUNT) : [];
  const yTicks = domain ? buildTicks(domain.minY, domain.maxY, GRID_LINE_COUNT) : [];

  return (
    <>
      <g className="experimentalChartGrid" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => {
          const y = PLOT.top + (index * (CHART_HEIGHT - PLOT.top - PLOT.bottom)) / 3;
          return <line key={`h-${index}`} x1={PLOT.left} x2={CHART_WIDTH - PLOT.right} y1={y} y2={y} />;
        })}
        {[0, 1, 2, 3].map((index) => {
          const x = PLOT.left + (index * (CHART_WIDTH - PLOT.left - PLOT.right)) / 3;
          return <line key={`v-${index}`} x1={x} x2={x} y1={PLOT.top} y2={CHART_HEIGHT - PLOT.bottom} />;
        })}
        <line className="experimentalChartAxis" x1={PLOT.left} x2={CHART_WIDTH - PLOT.right} y1={CHART_HEIGHT - PLOT.bottom} y2={CHART_HEIGHT - PLOT.bottom} />
        <line className="experimentalChartAxis" x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={CHART_HEIGHT - PLOT.bottom} />
      </g>
      <g className="experimentalChartTickLabels" aria-hidden="true">
        {xTicks.map((tick) => {
          const x = scaleX(tick, domain!);
          return (
            <text key={`x-tick-${tick}`} x={x} y={CHART_HEIGHT - 24} textAnchor="middle">
              {formatStrike(tick)}
            </text>
          );
        })}
        {yTicks.map((tick) => {
          const y = scaleY(tick, domain!);
          return (
            <text key={`y-tick-${tick}`} x={PLOT.left - 9} y={y + 4} textAnchor="end">
              {formatChartTickValue(tick, yValueKind)}
            </text>
          );
        })}
      </g>
      <text className="experimentalChartAxisLabel experimentalChartAxisLabel-x" x={CHART_WIDTH / 2} y={CHART_HEIGHT - 5} textAnchor="middle">
        {xAxisLabel}
      </text>
      <text
        className="experimentalChartAxisLabel experimentalChartAxisLabel-y"
        x={-(CHART_HEIGHT / 2)}
        y={14}
        textAnchor="middle"
        transform="rotate(-90)"
      >
        {yAxisLabel}
      </text>
    </>
  );
}

function buildTicks(min: number, max: number, count: number): number[] {
  if (count <= 1 || min === max) {
    return [min];
  }
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function formatStrike(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatChartValue(value: number, valueKind: ActiveChartPoint["valueKind"]): string {
  return valueKind === "percent" ? formatPercent(value, 2) : formatNumber(value, 4);
}

function formatChartTickValue(value: number, valueKind: ActiveChartPoint["valueKind"]): string {
  return valueKind === "percent" ? formatPercent(value, 1) : formatNumber(value, 3);
}

function findNearestForwardValue(points: ChartPoint[], forward: number): number | null {
  const validPoints = points.filter((point): point is { x: number; y: number } => point.y != null);

  if (validPoints.length === 0) {
    return null;
  }

  return validPoints.reduce((nearest, point) => {
    const nearestDistance = Math.abs(nearest.x - forward);
    const pointDistance = Math.abs(point.x - forward);
    return pointDistance < nearestDistance ? point : nearest;
  }).y;
}

function findLowestValuePoint(points: ChartPoint[]): { x: number; y: number } | null {
  const validPoints = points.filter((point): point is { x: number; y: number } => point.y != null);

  if (validPoints.length === 0) {
    return null;
  }

  return validPoints.reduce((lowest, point) => (point.y < lowest.y ? point : lowest));
}

function formatLowestPointLabel(point: { x: number; y: number } | null): string {
  if (!point) {
    return `${formatPercent(null, 2)} @ -`;
  }

  return `${formatPercent(point.y, 2)} @ ${formatStrike(point.x)}`;
}

function contiguousSegments(points: ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];

  for (const point of points) {
    if (point.y == null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(point);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function polylinePoints(points: ChartPoint[], domain: ChartDomain | null): string {
  if (!domain) {
    return "";
  }

  return points
    .filter((point) => point.y != null)
    .map((point) => `${scaleX(point.x, domain).toFixed(1)},${scaleY(point.y ?? 0, domain).toFixed(1)}`)
    .join(" ");
}

function domainForSeries(points: ChartPoint[]): ChartDomain | null {
  const validPoints = points.filter((point) => point.y != null);
  if (validPoints.length === 0) {
    return null;
  }

  const xValues = validPoints.map((point) => point.x);
  const yValues = validPoints.map((point) => point.y ?? 0);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const yPadding = Math.max((maxY - minY) * 0.12, 0.0001);

  return {
    minX,
    maxX: maxX === minX ? minX + 1 : maxX,
    minY: minY - yPadding,
    maxY: maxY + yPadding
  };
}

function scaleX(value: number, domain: ChartDomain): number {
  const width = CHART_WIDTH - PLOT.left - PLOT.right;
  return PLOT.left + ((value - domain.minX) / (domain.maxX - domain.minX)) * width;
}

function scaleY(value: number, domain: ChartDomain): number {
  const height = CHART_HEIGHT - PLOT.top - PLOT.bottom;
  return CHART_HEIGHT - PLOT.bottom - ((value - domain.minY) / (domain.maxY - domain.minY)) * height;
}
