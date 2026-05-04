import type { AnalyticsSnapshot } from "./contracts";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartFrame {
  width: number;
  height: number;
  padding: number;
}

export type NumericRowKey = {
  [Key in keyof AnalyticsRow]-?: Exclude<AnalyticsRow[Key], undefined> extends number | null ? Key : never;
}[keyof AnalyticsRow];

export function buildSeries(rows: Array<Pick<AnalyticsRow, "strike"> & Partial<Record<NumericRowKey, number | null>>>, key: NumericRowKey): ChartPoint[] {
  return rows
    .flatMap((row) => {
      const value = row[key];
      return typeof value === "number" ? [{ x: row.strike, y: value }] : [];
    })
    .sort((a, b) => a.x - b.x);
}

export function buildPath(points: ChartPoint[], frame: ChartFrame, domainPoints: ChartPoint[] = points): string {
  if (points.length < 2) {
    return "";
  }

  return points
    .map((point, index) => {
      const projected = projectPoint(point, domainPoints, frame);
      const command = index === 0 ? "M" : "L";
      return `${command} ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
    })
    .join(" ");
}

export function projectPoint(point: ChartPoint, points: ChartPoint[], frame: ChartFrame): ChartPoint {
  const xValues = points.map((item) => item.x);
  const yValues = points.map((item) => item.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const innerWidth = frame.width - frame.padding * 2;
  const innerHeight = frame.height - frame.padding * 2;
  const xRatio = ratio(point.x, minX, maxX);
  const yRatio = ratio(point.y, minY, maxY);

  return {
    x: frame.padding + xRatio * innerWidth,
    y: frame.height - frame.padding - yRatio * innerHeight
  };
}

export function valueExtent(points: ChartPoint[]): [number, number] | null {
  if (points.length === 0) {
    return null;
  }
  const values = points.map((point) => point.y);
  return [Math.min(...values), Math.max(...values)];
}

function ratio(value: number, min: number, max: number): number {
  if (min === max) {
    return 0.5;
  }
  return (value - min) / (max - min);
}
