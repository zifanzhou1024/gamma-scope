import React from "react";
import { ExperimentalPanel } from "./ExperimentalPanel";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatPercent } from "../../lib/dashboardMetrics";

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

const CHART_WIDTH = 640;
const CHART_HEIGHT = 260;
const PLOT = {
  left: 44,
  right: 18,
  top: 18,
  bottom: 38
};

const SERIES_CLASSES = ["experimentalSeries-blue", "experimentalSeries-teal", "experimentalSeries-violet", "experimentalSeries-amber"];

export function ExperimentalSmileChart({ analytics }: ExperimentalSmileChartProps) {
  return (
    <section className="experimentalChartsGrid" aria-label="Experimental charts">
      <ExperimentalPanel
        title={analytics.ivSmiles.label}
        description="Method comparison across strike."
        status={analytics.ivSmiles.status}
        diagnostics={analytics.ivSmiles.diagnostics}
      >
        <div className="experimentalChartFrame">
          <svg
            className="experimentalChartSvg"
            role="img"
            aria-label="IV smile methods chart"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          >
            <ChartGrid />
            {analytics.ivSmiles.methods.map((method, index) => (
              <polyline
                key={method.key}
                data-series-key={method.key}
                className={`experimentalSeries ${SERIES_CLASSES[index % SERIES_CLASSES.length]}`}
                points={polylinePoints(method.points, domainForSeries(analytics.ivSmiles.methods.flatMap((entry) => entry.points)))}
                fill="none"
              />
            ))}
          </svg>
        </div>
        <div className="experimentalLegend" aria-label="IV smile methods">
          {analytics.ivSmiles.methods.map((method, index) => (
            <span key={method.key}>
              <i className={SERIES_CLASSES[index % SERIES_CLASSES.length]} aria-hidden="true" />
              {method.label}
            </span>
          ))}
        </div>
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.terminalDistribution.label}
        description="Risk-neutral terminal density."
        status={analytics.terminalDistribution.status}
        diagnostics={analytics.terminalDistribution.diagnostics}
      >
        <div className="experimentalChartFrame">
          <svg
            className="experimentalChartSvg"
            role="img"
            aria-label="Terminal distribution chart"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          >
            <ChartGrid />
            <polyline
              className="experimentalSeries experimentalSeries-distribution"
              points={polylinePoints(analytics.terminalDistribution.density, domainForSeries(analytics.terminalDistribution.density))}
              fill="none"
            />
          </svg>
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

function ChartGrid() {
  return (
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
  );
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
