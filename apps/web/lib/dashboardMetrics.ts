import type { AnalyticsSnapshot } from "./contracts";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];

export interface SnapshotSummary {
  rowCount: number;
  strikeRange: [number, number] | null;
  averageIv: number | null;
  totalAbsGamma: number;
  totalAbsVanna: number;
}

export function summarizeSnapshot(snapshot: AnalyticsSnapshot): SnapshotSummary {
  const strikes = snapshot.rows.map((row) => row.strike);
  const ivValues = compactNumbers(snapshot.rows.map((row) => row.custom_iv));
  const gammaValues = compactNumbers(snapshot.rows.map((row) => row.custom_gamma));
  const vannaValues = compactNumbers(snapshot.rows.map((row) => row.custom_vanna));

  return {
    rowCount: snapshot.rows.length,
    strikeRange: strikes.length > 0 ? [Math.min(...strikes), Math.max(...strikes)] : null,
    averageIv: average(ivValues),
    totalAbsGamma: sumAbs(gammaValues),
    totalAbsVanna: sumAbs(vannaValues)
  };
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null) {
    return "—";
  }
  return value.toFixed(digits);
}

export function formatBasisPointDiff(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return `${(value * 10000).toFixed(1)} bp`;
}

export function formatStatusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatStrikeRange(range: [number, number] | null): string {
  if (range == null) {
    return "—";
  }
  if (range[0] === range[1]) {
    return range[0].toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return `${range[0].toLocaleString("en-US", { maximumFractionDigits: 0 })}–${range[1].toLocaleString("en-US", {
    maximumFractionDigits: 0
  })}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

export function sortRowsByStrike(rows: AnalyticsRow[]): AnalyticsRow[] {
  return [...rows].sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right));
}

function compactNumbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value != null);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sumAbs(values: number[]): number {
  return values.reduce((total, value) => total + Math.abs(value), 0);
}
