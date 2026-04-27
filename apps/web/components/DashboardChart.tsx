import React from "react";
import { buildPath, buildSeries, projectPoint, valueExtent, type ChartPoint, type NumericRowKey } from "../lib/chartGeometry";
import type { StrikeInspection } from "../lib/chartInspection";
import { formatNumber, formatPercent } from "../lib/dashboardMetrics";
import type { AnalyticsSnapshot } from "../lib/contracts";

type ChartTone = "blue" | "violet" | "teal";

interface DashboardChartProps {
  rows: AnalyticsSnapshot["rows"];
  title: string;
  metricKey: NumericRowKey;
  tone: ChartTone;
  valueKind: "percent" | "decimal";
  spot?: number | null;
  forward?: number | null;
  atmValue?: number | null;
  showZeroLine?: boolean;
  inspectedStrike?: number | null;
  inspection?: StrikeInspection | null;
  onInspectStrike?: (strike: number) => void;
  onClearInspection?: () => void;
}

interface RenderSeries {
  key: string;
  label: string;
  points: ChartPoint[];
}

const FRAME = { width: 560, height: 300, padding: 42 };
const GRID_LINES = 4;

export function DashboardChart({
  rows,
  title,
  metricKey,
  tone,
  valueKind,
  spot = null,
  forward = null,
  atmValue = null,
  showZeroLine = false,
  inspectedStrike = null,
  inspection = null,
  onInspectStrike,
  onClearInspection
}: DashboardChartProps) {
  const renderSeries = buildRenderSeries(rows, metricKey);
  const domainPoints = renderSeries.flatMap((series) => series.points);
  const strikeHitZones = buildStrikeHitZones(domainPoints);
  const ivMinimumPoints = metricKey === "custom_iv" ? buildIvMinimumPoints(renderSeries) : [];
  const extent = valueExtent(domainPoints);
  const latest = domainPoints.at(-1)?.y ?? null;
  const headlineValue = atmValue ?? latest;
  const headlineLabel = headlineLabelFor(metricKey, atmValue);
  const xTicks = buildTicks(domainPoints.map((point) => point.x), 3);
  const yTicks = buildTicks(domainPoints.map((point) => point.y), GRID_LINES);
  const chartTitle = chartTitleFor(metricKey, title);
  const axisLabel = axisLabelFor(metricKey);
  const strikeCount = new Set(domainPoints.map((point) => point.x)).size;
  const referenceLines = buildReferenceLines({ spot, forward }, domainPoints);
  const showVannaZeroLine = metricKey === "custom_vanna" && showZeroLine && isInYDomain(0, domainPoints);
  const inspectedStrikeInDomain = inspectedStrike != null && isInStrikeDomain(inspectedStrike, strikeHitZones);
  const isInspectable = Boolean(onInspectStrike);
  const chartRole = isInspectable ? "group" : "img";
  const chartLabel = isInspectable ? `${chartTitle} interactive strike inspection` : undefined;

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
      {ivMinimumPoints.length > 0 ? <IvMinimumSummary minimumPoints={ivMinimumPoints} /> : null}
      <svg
        className={`chart chart-${tone}`}
        viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
        role={chartRole}
        aria-label={chartLabel}
      >
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
        {referenceLines.map((line) => (
          <ReferenceLine key={line.key} line={line} domainPoints={domainPoints} />
        ))}
        {showVannaZeroLine ? <ZeroLine domainPoints={domainPoints} /> : null}
        {inspectedStrikeInDomain ? <InspectionCrosshair strike={inspectedStrike} domainPoints={domainPoints} /> : null}
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
            {metricKey === "custom_iv" ? <IvMinimumMarker series={series} domainPoints={domainPoints} /> : null}
          </g>
        ))}
        {isInspectable ? (
          <g className="chartHitZones">
            {strikeHitZones.map((zone) => (
              <rect
                key={`hit-zone-${zone.strike}`}
                className="chartHitZone"
                data-chart-hit-strike={zone.strike}
                x={zone.x}
                y={FRAME.padding}
                width={zone.width}
                height={FRAME.height - FRAME.padding * 2}
                tabIndex={0}
                role="button"
                aria-label={`Inspect ${formatStrike(zone.strike)}`}
                onMouseEnter={() => onInspectStrike?.(zone.strike)}
                onFocus={() => onInspectStrike?.(zone.strike)}
                onKeyDown={(event) => handleHitZoneKeyDown(event, zone.strike, onInspectStrike, onClearInspection)}
              />
            ))}
          </g>
        ) : null}
      </svg>
      {inspection && inspectedStrikeInDomain ? <InspectionChip inspection={inspection} metricKey={metricKey} /> : null}
      <div className="chartStats" aria-label={`${chartTitle} summary`}>
        <ChartStat label={headlineLabel} value={formatHeadlineValue(headlineValue, valueKind, atmValue != null)} />
        <ChartStat label="Min" value={formatValue(extent?.[0] ?? null, valueKind)} />
        <ChartStat label="Max" value={formatValue(extent?.[1] ?? null, valueKind)} />
      </div>
    </section>
  );
}

interface StrikeHitZone {
  strike: number;
  x: number;
  width: number;
}

interface IvMinimumPoint {
  seriesKey: string;
  seriesLabel: string;
  point: ChartPoint;
}

interface ReferenceLineModel {
  key: "spot" | "forward";
  label: string;
  value: number;
}

function ReferenceLine({ line, domainPoints }: { line: ReferenceLineModel; domainPoints: ChartPoint[] }) {
  const x = projectX(line.value, domainPoints);
  const y = line.key === "spot" ? FRAME.padding + 12 : FRAME.padding + 26;
  const isRightSide = x > FRAME.width / 2;
  const labelX = isRightSide ? x - 6 : x + 6;
  const textAnchor = isRightSide ? "end" : "start";

  return (
    <g className={`chartReferenceLine chartReferenceLine-${line.key}`} data-reference-line={line.key} aria-label={line.label}>
      <line x1={x} x2={x} y1={FRAME.padding} y2={FRAME.height - FRAME.padding} />
      <text x={labelX} y={y} textAnchor={textAnchor}>
        {line.label}
      </text>
    </g>
  );
}

function ZeroLine({ domainPoints }: { domainPoints: ChartPoint[] }) {
  const y = projectY(0, domainPoints);

  return (
    <g className="chartZeroLine chartZeroLine-vanna" data-zero-line="vanna" aria-label="Vanna 0">
      <line x1={FRAME.padding} x2={FRAME.width - FRAME.padding} y1={y} y2={y} />
      <text x={FRAME.width - FRAME.padding - 48} y={y - 6}>
        Vanna 0
      </text>
    </g>
  );
}

function InspectionCrosshair({ strike, domainPoints }: { strike: number; domainPoints: ChartPoint[] }) {
  const x = projectX(strike, domainPoints);

  return (
    <line
      className="chartInspectionCrosshair"
      data-inspection-crosshair={strike}
      x1={x}
      x2={x}
      y1={FRAME.padding}
      y2={FRAME.height - FRAME.padding}
      aria-hidden="true"
    />
  );
}

function InspectionChip({ inspection, metricKey }: { inspection: StrikeInspection; metricKey: NumericRowKey }) {
  const values = inspectionChipValues(inspection, metricKey);

  return (
    <div
      className="chartInspectionChip"
      data-chart-inspection-chip={inspection.strike}
      aria-label={`Selected strike ${formatStrike(inspection.strike)}`}
    >
      <strong>{formatStrike(inspection.strike)}</strong>
      <span>
        {values.callLabel} {values.callValue}
      </span>
      <span>
        {values.putLabel} {values.putValue}
      </span>
    </div>
  );
}

function inspectionChipValues(inspection: StrikeInspection, metricKey: NumericRowKey) {
  if (metricKey === "custom_iv") {
    return { callLabel: "Call IV", callValue: inspection.call.iv, putLabel: "Put IV", putValue: inspection.put.iv };
  }
  if (metricKey === "custom_gamma") {
    return { callLabel: "Call Γ", callValue: inspection.call.gamma, putLabel: "Put Γ", putValue: inspection.put.gamma };
  }
  if (metricKey === "custom_vanna") {
    return { callLabel: "Call Vanna", callValue: inspection.call.vanna, putLabel: "Put Vanna", putValue: inspection.put.vanna };
  }
  return { callLabel: "Call", callValue: "N/A", putLabel: "Put", putValue: "N/A" };
}

function handleHitZoneKeyDown(
  event: React.KeyboardEvent<SVGRectElement>,
  strike: number,
  onInspectStrike: ((strike: number) => void) | undefined,
  onClearInspection: (() => void) | undefined
) {
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    onInspectStrike?.(strike);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    onClearInspection?.();
  }
}

function IvMinimumSummary({ minimumPoints }: { minimumPoints: IvMinimumPoint[] }) {
  return (
    <div className="ivMinSummary" data-iv-min-summary="true" aria-label="IV low points">
      <span className="ivMinSummaryTitle">IV LOW POINTS</span>
      <div className="ivMinSummaryItems">
        {minimumPoints.map((minimumPoint) => (
          <span key={minimumPoint.seriesKey} className={`ivMinSummaryItem ivMinSummaryItem-${minimumPoint.seriesKey}`}>
            <i aria-hidden="true" />
            {minimumPoint.seriesLabel.replace(" IV", "")} {formatPercent(minimumPoint.point.y, 1)} @{" "}
            {formatStrike(minimumPoint.point.x)}
          </span>
        ))}
      </div>
    </div>
  );
}

function IvMinimumMarker({ series, domainPoints }: { series: RenderSeries; domainPoints: ChartPoint[] }) {
  const minimumPoint = findMinimumPoint(series.points);
  if (!minimumPoint) {
    return null;
  }

  const projected = projectPoint(minimumPoint, domainPoints, FRAME);
  const label = `${series.label.replace(" IV", "")} min ${formatPercent(minimumPoint.y, 1)} @ ${formatStrike(minimumPoint.x)}`;

  return (
    <g className="chartIvMinMarker" data-iv-min-marker={series.key} aria-label={label}>
      <circle cx={projected.x} cy={projected.y} r="7" />
    </g>
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

function buildIvMinimumPoints(renderSeries: RenderSeries[]): IvMinimumPoint[] {
  return renderSeries.flatMap((series) => {
    const point = findMinimumPoint(series.points);
    return point ? [{ seriesKey: series.key, seriesLabel: series.label, point }] : [];
  });
}

function buildReferenceLines(
  values: { spot: number | null; forward: number | null },
  domainPoints: ChartPoint[]
): ReferenceLineModel[] {
  const lines: ReferenceLineModel[] = [];

  if (values.spot != null && isInXDomain(values.spot, domainPoints)) {
    lines.push({ key: "spot", label: `SPX spot ${formatReferenceValue(values.spot)}`, value: values.spot });
  }
  if (values.forward != null && isInXDomain(values.forward, domainPoints)) {
    lines.push({ key: "forward", label: `Forward ${formatReferenceValue(values.forward)}`, value: values.forward });
  }

  return lines;
}

function buildStrikeHitZones(domainPoints: ChartPoint[]): StrikeHitZone[] {
  const strikes = Array.from(new Set(domainPoints.map((point) => point.x))).sort((a, b) => a - b);
  if (strikes.length === 0) {
    return [];
  }

  return strikes.map((strike, index) => {
    const x = projectX(strike, domainPoints);
    const previousX = index > 0 ? projectX(strikes[index - 1], domainPoints) : FRAME.padding;
    const nextX = index < strikes.length - 1 ? projectX(strikes[index + 1], domainPoints) : FRAME.width - FRAME.padding;
    const left = index > 0 ? (previousX + x) / 2 : FRAME.padding;
    const right = index < strikes.length - 1 ? (x + nextX) / 2 : FRAME.width - FRAME.padding;

    return {
      strike,
      x: left,
      width: Math.max(right - left, 1)
    };
  });
}

function isInStrikeDomain(strike: number, strikeHitZones: StrikeHitZone[]): boolean {
  return strikeHitZones.some((zone) => zone.strike === strike);
}

function findMinimumPoint(points: ChartPoint[]): ChartPoint | null {
  return points.reduce<ChartPoint | null>((minimumPoint, point) => {
    if (!minimumPoint || point.y < minimumPoint.y) {
      return point;
    }
    return minimumPoint;
  }, null);
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

function headlineLabelFor(metricKey: NumericRowKey, atmValue: number | null): string {
  if (atmValue == null) {
    return "Current";
  }
  if (metricKey === "custom_iv") {
    return "ATM IV";
  }
  if (metricKey === "custom_gamma") {
    return "ATM Gamma";
  }
  if (metricKey === "custom_vanna") {
    return "ATM Vanna";
  }
  return "Current";
}

function formatValue(value: number | null, valueKind: DashboardChartProps["valueKind"]): string {
  return valueKind === "percent" ? formatPercent(value) : formatNumber(value, 4);
}

function formatHeadlineValue(value: number | null, valueKind: DashboardChartProps["valueKind"], isAtmValue: boolean): string {
  if (!isAtmValue) {
    return formatValue(value, valueKind);
  }
  return valueKind === "percent" ? formatPercent(value) : formatNumber(value, 5);
}

function formatStrike(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatReferenceValue(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isInXDomain(value: number, domainPoints: ChartPoint[]): boolean {
  const xValues = domainPoints.map((point) => point.x);
  return isInExtent(value, xValues);
}

function isInYDomain(value: number, domainPoints: ChartPoint[]): boolean {
  const yValues = domainPoints.map((point) => point.y);
  return isInExtent(value, yValues);
}

function isInExtent(value: number, values: number[]): boolean {
  if (values.length === 0) {
    return false;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return value >= min && value <= max;
}

function projectX(value: number, domainPoints: ChartPoint[]): number {
  return projectPoint({ x: value, y: domainPoints[0]?.y ?? 0 }, domainPoints, FRAME).x;
}

function projectY(value: number, domainPoints: ChartPoint[]): number {
  return projectPoint({ x: domainPoints[0]?.x ?? 0, y: value }, domainPoints, FRAME).y;
}
