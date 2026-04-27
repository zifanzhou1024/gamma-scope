import React from "react";
import { buildPath, buildSeries, projectPoint, valueExtent, type ChartPoint, type NumericRowKey } from "../lib/chartGeometry";
import { formatNumber, formatPercent } from "../lib/dashboardMetrics";
import type { AnalyticsSnapshot } from "../lib/contracts";

type ChartTone = "blue" | "violet" | "teal";

interface DashboardChartProps {
  rows: AnalyticsSnapshot["rows"];
  title: string;
  metricKey: NumericRowKey;
  tone: ChartTone;
  valueKind: "percent" | "decimal";
}

interface RenderSeries {
  key: string;
  label: string;
  points: ChartPoint[];
}

const FRAME = { width: 560, height: 300, padding: 42 };
const GRID_LINES = 4;

export function DashboardChart({ rows, title, metricKey, tone, valueKind }: DashboardChartProps) {
  const renderSeries = buildRenderSeries(rows, metricKey);
  const domainPoints = renderSeries.flatMap((series) => series.points);
  const extent = valueExtent(domainPoints);
  const latest = domainPoints.at(-1)?.y ?? null;
  const xTicks = buildTicks(domainPoints.map((point) => point.x), 3);
  const yTicks = buildTicks(domainPoints.map((point) => point.y), GRID_LINES);
  const chartTitle = chartTitleFor(metricKey, title);
  const axisLabel = axisLabelFor(metricKey);
  const strikeCount = new Set(domainPoints.map((point) => point.x)).size;

  return (
    <section className="chartPanel" aria-label={chartTitle}>
      <div className="panelHeader chartPanelHeader">
        <div>
          <h2>{chartTitle}</h2>
          <p>{strikeCount} strikes</p>
        </div>
        <strong>{formatValue(latest, valueKind)}</strong>
      </div>
      <div className={`chartLegend chartLegend-${tone}`} aria-label={`${chartTitle} series`}>
        {renderSeries.map((series) => (
          <span key={series.key} className={`chartLegendItem chartLegend-${series.key}`}>
            <i aria-hidden="true" />
            {series.label}
          </span>
        ))}
      </div>
      <svg className={`chart chart-${tone}`} viewBox={`0 0 ${FRAME.width} ${FRAME.height}`} role="img">
        <title>{chartTitle}</title>
        <g data-chart-grid="market-ops" className="chartGridLines" aria-hidden="true">
          {yTicks.map((tick) => {
            const y = projectY(tick, domainPoints);
            return (
              <line
                key={`y-grid-${tick}`}
                x1={FRAME.padding}
                x2={FRAME.width - FRAME.padding}
                y1={y}
                y2={y}
              />
            );
          })}
          {xTicks.map((tick) => {
            const x = projectX(tick, domainPoints);
            return (
              <line
                key={`x-grid-${tick}`}
                x1={x}
                x2={x}
                y1={FRAME.padding}
                y2={FRAME.height - FRAME.padding}
              />
            );
          })}
        </g>
        <line
          className="chartAxis"
          data-axis="x"
          x1={FRAME.padding}
          x2={FRAME.width - FRAME.padding}
          y1={FRAME.height - FRAME.padding}
          y2={FRAME.height - FRAME.padding}
        />
        <line
          className="chartAxis"
          data-axis="y"
          x1={FRAME.padding}
          x2={FRAME.padding}
          y1={FRAME.padding}
          y2={FRAME.height - FRAME.padding}
        />
        <g className="chartTickLabels" aria-hidden="true">
          {xTicks.map((tick) => (
            <text key={`x-tick-${tick}`} x={projectX(tick, domainPoints)} y={FRAME.height - 18} textAnchor="middle">
              {formatStrike(tick)}
            </text>
          ))}
          {yTicks.map((tick) => (
            <text key={`y-tick-${tick}`} x={FRAME.padding - 10} y={projectY(tick, domainPoints) + 4} textAnchor="end">
              {formatValue(tick, valueKind)}
            </text>
          ))}
        </g>
        <text className="chartAxisLabel chartAxisLabel-x" x={FRAME.width / 2} y={FRAME.height - 2} textAnchor="middle">
          Strike
        </text>
        <text
          className="chartAxisLabel chartAxisLabel-y"
          x={-(FRAME.height / 2)}
          y={13}
          textAnchor="middle"
          transform="rotate(-90)"
        >
          {axisLabel}
        </text>
        {renderSeries.map((series) => (
          <g key={series.key} className={`chartSeries chartSeries-${series.key}`} data-series={series.key}>
            {series.points.length > 1 ? <path d={buildPath(series.points, FRAME, domainPoints)} /> : null}
            {series.points.map((point, index) => {
              const projected = projectPoint(point, domainPoints, FRAME);
              return <circle key={`${series.key}-${point.x}-${point.y}-${index}`} cx={projected.x} cy={projected.y} r="3.5" />;
            })}
          </g>
        ))}
      </svg>
      <div className="chartStats" aria-label={`${chartTitle} summary`}>
        <ChartStat label="Current" value={formatValue(latest, valueKind)} />
        <ChartStat label="Min" value={formatValue(extent?.[0] ?? null, valueKind)} />
        <ChartStat label="Max" value={formatValue(extent?.[1] ?? null, valueKind)} />
      </div>
    </section>
  );
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function buildRenderSeries(rows: DashboardChartProps["rows"], metricKey: NumericRowKey): RenderSeries[] {
  if (metricKey === "custom_iv") {
    const callPoints = buildSeries(rows.filter((row) => row.right === "call"), metricKey);
    const putPoints = buildSeries(rows.filter((row) => row.right === "put"), metricKey);

    if (callPoints.length > 0 && putPoints.length > 0) {
      return [
        { key: "call-iv", label: "Call IV", points: callPoints },
        { key: "put-iv", label: "Put IV", points: putPoints }
      ];
    }
  }

  return [{ key: "primary", label: axisLabelFor(metricKey), points: buildSeries(rows, metricKey) }];
}

function buildTicks(values: number[], count: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max || count <= 1) {
    return [min];
  }
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function chartTitleFor(metricKey: NumericRowKey, fallback: string): string {
  if (metricKey === "custom_iv") {
    return "IV BY STRIKE";
  }
  if (metricKey === "custom_gamma") {
    return "GAMMA BY STRIKE";
  }
  if (metricKey === "custom_vanna") {
    return "VANNA BY STRIKE";
  }
  return fallback.toUpperCase();
}

function axisLabelFor(metricKey: NumericRowKey): string {
  if (metricKey === "custom_iv") {
    return "IV (%)";
  }
  if (metricKey === "custom_gamma") {
    return "Gamma";
  }
  if (metricKey === "custom_vanna") {
    return "Vanna";
  }
  return "Value";
}

function formatValue(value: number | null, valueKind: DashboardChartProps["valueKind"]): string {
  return valueKind === "percent" ? formatPercent(value) : formatNumber(value, 4);
}

function formatStrike(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function projectX(value: number, domainPoints: ChartPoint[]): number {
  return projectPoint({ x: value, y: domainPoints[0]?.y ?? 0 }, domainPoints, FRAME).x;
}

function projectY(value: number, domainPoints: ChartPoint[]): number {
  return projectPoint({ x: domainPoints[0]?.x ?? 0, y: value }, domainPoints, FRAME).y;
}
