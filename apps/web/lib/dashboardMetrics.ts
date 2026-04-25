import type { AnalyticsSnapshot } from "./contracts";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];
type ComparisonStatus = AnalyticsRow["comparison_status"];

export type ComparisonTone = "ok" | "warning" | "muted";

export interface ComparisonStatusDisplay {
  label: string;
  tone: ComparisonTone;
}

export interface SnapshotSummary {
  rowCount: number;
  strikeRange: [number, number] | null;
  averageIv: number | null;
  totalAbsGamma: number;
  totalAbsVanna: number;
}

export interface ChainStrikeRow {
  strike: number;
  call: AnalyticsRow | null;
  put: AnalyticsRow | null;
}

export type ChainSide = "all" | "calls" | "puts";

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

export function formatIvDiffBasisPoints(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  const basisPoints = value * 10000;
  return `${formatSignedFixed(basisPoints, 1)} bp`;
}

export function formatGammaDiff(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return formatSignedFixed(value, 5);
}

export function formatInteger(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatStatusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function getComparisonStatusDisplay(status: ComparisonStatus | null | undefined): ComparisonStatusDisplay {
  if (status == null) {
    return { label: "No IBKR", tone: "muted" };
  }

  if (status === "ok") {
    return { label: "OK", tone: "ok" };
  }

  const warningStatuses: ComparisonStatus[] = ["stale", "outside_tolerance"];

  return {
    label: formatComparisonStatusLabel(status),
    tone: warningStatuses.includes(status) ? "warning" : "muted"
  };
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
    timeZone: "America/New_York",
    timeZoneName: "short"
  }).format(new Date(value));
}

export function sortRowsByStrike(rows: AnalyticsRow[]): AnalyticsRow[] {
  return [...rows].sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right));
}

export function groupRowsByStrike(rows: AnalyticsRow[]): ChainStrikeRow[] {
  const grouped = new Map<number, ChainStrikeRow>();

  for (const row of rows) {
    const existing = grouped.get(row.strike) ?? { strike: row.strike, call: null, put: null };
    if (row.right === "call") {
      existing.call = row;
    } else {
      existing.put = row;
    }
    grouped.set(row.strike, existing);
  }

  return [...grouped.values()].sort((a, b) => a.strike - b.strike);
}

export function filterChainRowsBySide(rows: ChainStrikeRow[], side: ChainSide): ChainStrikeRow[] {
  if (side === "all") {
    return rows;
  }

  return rows.map((row) => ({
    ...row,
    call: side === "puts" ? null : row.call,
    put: side === "calls" ? null : row.put
  }));
}

export function nearestStrike(snapshot: AnalyticsSnapshot): number | null {
  if (snapshot.rows.length === 0) {
    return null;
  }
  return snapshot.rows.reduce((nearest, row) => {
    const currentDistance = Math.abs(row.strike - snapshot.spot);
    const nearestDistance = Math.abs(nearest - snapshot.spot);
    return currentDistance < nearestDistance ? row.strike : nearest;
  }, snapshot.rows[0].strike);
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

function formatSignedFixed(value: number, digits: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(digits)}`;
}

function formatComparisonStatusLabel(status: ComparisonStatus): string {
  const label = formatStatusLabel(status);
  return `${label.charAt(0)}${label.slice(1).toLowerCase()}`;
}
