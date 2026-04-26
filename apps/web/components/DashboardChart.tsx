import { buildPath, buildSeries, valueExtent, type NumericRowKey } from "../lib/chartGeometry";
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

const FRAME = { width: 420, height: 210, padding: 28 };

export function DashboardChart({ rows, title, metricKey, tone, valueKind }: DashboardChartProps) {
  const series = buildSeries(rows, metricKey);
  const path = buildPath(series, FRAME);
  const extent = valueExtent(series);
  const latest = series.at(-1)?.y ?? null;

  return (
    <section className="chartPanel" aria-label={title}>
      <div className="panelHeader">
        <div>
          <h2>{title}</h2>
          <p>{series.length} strikes</p>
        </div>
        <strong>{formatValue(latest, valueKind)}</strong>
      </div>
      <svg className={`chart chart-${tone}`} viewBox={`0 0 ${FRAME.width} ${FRAME.height}`} role="img">
        <line x1={FRAME.padding} x2={FRAME.width - FRAME.padding} y1={FRAME.height - FRAME.padding} y2={FRAME.height - FRAME.padding} />
        <line x1={FRAME.padding} x2={FRAME.padding} y1={FRAME.padding} y2={FRAME.height - FRAME.padding} />
        {path ? <path d={path} /> : null}
        {series.map((point, index) => (
          <circle
            key={`${title}-${point.x}-${point.y}-${index}`}
            cx={projectX(point.x, series)}
            cy={projectY(point.y, series)}
            r="3.5"
          />
        ))}
      </svg>
      <div className="chartFooter">
        <span>{extent ? formatValue(extent[0], valueKind) : "—"}</span>
        <span>{extent ? formatValue(extent[1], valueKind) : "—"}</span>
      </div>
    </section>
  );
}

function formatValue(value: number | null, valueKind: DashboardChartProps["valueKind"]): string {
  return valueKind === "percent" ? formatPercent(value) : formatNumber(value, 4);
}

function projectX(value: number, series: Array<{ x: number; y: number }>): number {
  const values = series.map((point) => point.x);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = min === max ? 0.5 : (value - min) / (max - min);
  return FRAME.padding + ratio * (FRAME.width - FRAME.padding * 2);
}

function projectY(value: number, series: Array<{ x: number; y: number }>): number {
  const values = series.map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ratio = min === max ? 0.5 : (value - min) / (max - min);
  return FRAME.height - FRAME.padding - ratio * (FRAME.height - FRAME.padding * 2);
}
