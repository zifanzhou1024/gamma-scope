import type { AnalyticsSnapshot } from "./contracts";
import type { CollectorHealth } from "./clientCollectorStatusSource";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];
type CalcStatus = AnalyticsRow["calc_status"];
type ComparisonStatus = AnalyticsRow["comparison_status"];
type SourceStatus = AnalyticsSnapshot["source_status"];
type CoverageStatus = AnalyticsSnapshot["coverage_status"];
type CollectorStatus = CollectorHealth["status"];

export type ComparisonTone = "ok" | "warning" | "muted";
export type OperationalTone = "ok" | "warning" | "error" | "muted";
export type LiveTransportStatus = "connecting" | "streaming" | "disconnected" | "fallback_polling" | "reconnecting";

export interface ComparisonStatusDisplay {
  label: string;
  tone: ComparisonTone;
}

export interface OperationalStatusDisplay {
  label: string;
  tone: OperationalTone;
}

export interface OperationalNotice extends OperationalStatusDisplay {
  key: string;
  message: string;
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

export function getTransportStatusDisplay(status: LiveTransportStatus): OperationalStatusDisplay {
  if (status === "streaming") {
    return { label: "Streaming", tone: "ok" };
  }
  if (status === "disconnected") {
    return { label: "Disconnected", tone: "error" };
  }
  if (status === "fallback_polling") {
    return { label: "Fallback polling", tone: "warning" };
  }
  if (status === "reconnecting") {
    return { label: "Reconnecting", tone: "muted" };
  }
  return { label: "Connecting", tone: "muted" };
}

export function getRowOperationalStatusDisplay(row: AnalyticsRow | null | undefined): OperationalStatusDisplay | null {
  return getRowOperationalStatusDisplays(row)[0] ?? null;
}

export function getRowOperationalStatusDisplays(row: AnalyticsRow | null | undefined): OperationalStatusDisplay[] {
  if (row == null) {
    return [];
  }

  const statuses: OperationalStatusDisplay[] = [];

  if (isCrossedQuote(row)) {
    statuses.push({ label: "Crossed quote", tone: "warning" });
  }

  if (row.calc_status !== "ok") {
    statuses.push({
      label: formatOperationalStatusLabel(row.calc_status),
      tone: calcStatusTone(row.calc_status)
    });
  }

  return statuses;
}

export function deriveOperationalNotices(
  snapshot: AnalyticsSnapshot,
  collectorHealth?: CollectorHealth | null,
  transportStatus?: LiveTransportStatus | null
): OperationalNotice[] {
  const notices: OperationalNotice[] = [];

  if (transportStatus && transportStatus !== "streaming") {
    const display = getTransportStatusDisplay(transportStatus);
    notices.push({
      key: `transport-${transportStatus}`,
      label: display.label,
      message: transportStatusMessage(transportStatus),
      tone: display.tone
    });
  }

  if (snapshot.coverage_status !== "full") {
    notices.push({
      key: `coverage-${snapshot.coverage_status}`,
      label: coverageStatusLabel(snapshot.coverage_status),
      message: coverageStatusMessage(snapshot.coverage_status),
      tone: snapshot.coverage_status === "empty" ? "error" : "warning"
    });
  }

  if (snapshot.source_status !== "connected") {
    notices.push({
      key: `source-${snapshot.source_status}`,
      label: `Source ${formatStatusLabel(snapshot.source_status).toLowerCase()}`,
      message: `Snapshot source is ${formatStatusLabel(snapshot.source_status).toLowerCase()}.`,
      tone: sourceStatusTone(snapshot.source_status)
    });
  }

  if (collectorHealth && collectorHealth.status !== "connected") {
    notices.push({
      key: `collector-${collectorHealth.status}`,
      label: `Collector ${formatStatusLabel(collectorHealth.status).toLowerCase()}`,
      message: collectorHealth.message || `Collector is ${formatStatusLabel(collectorHealth.status).toLowerCase()}.`,
      tone: collectorStatusTone(collectorHealth.status)
    });
  }

  const crossedQuoteCount = snapshot.rows.filter(isCrossedQuote).length;
  if (crossedQuoteCount > 0) {
    notices.push({
      key: "quotes-crossed",
      label: "Crossed quotes",
      message: `${crossedQuoteCount} ${crossedQuoteCount === 1 ? "option has" : "options have"} bid above ask.`,
      tone: "warning"
    });
  }

  const calcCounts = countCalcIssues(snapshot.rows);
  if (calcCounts.size > 0) {
    notices.push({
      key: "calc-issues",
      label: "Calculation issues",
      message: formatCalcIssueSummary(calcCounts),
      tone: [...calcCounts.keys()].some((status) => calcStatusTone(status) === "error") ? "error" : "warning"
    });
  }

  return dedupeNotices(notices);
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
  return formatOperationalStatusLabel(status);
}

function formatOperationalStatusLabel(status: string): string {
  const label = formatStatusLabel(status);
  return `${label.charAt(0)}${label.slice(1).toLowerCase()}`;
}

function isCrossedQuote(row: AnalyticsRow): boolean {
  return row.bid != null && row.ask != null && row.bid > row.ask;
}

function calcStatusTone(status: CalcStatus): OperationalTone {
  if (status === "solver_failed") {
    return "error";
  }
  if (status === "out_of_model_scope") {
    return "muted";
  }
  return "warning";
}

function sourceStatusTone(status: SourceStatus): OperationalTone {
  if (status === "disconnected" || status === "error") {
    return "error";
  }
  if (status === "degraded" || status === "stale") {
    return "warning";
  }
  return "muted";
}

function collectorStatusTone(status: CollectorStatus): OperationalTone {
  if (status === "disconnected" || status === "error") {
    return "error";
  }
  if (status === "degraded" || status === "stale") {
    return "warning";
  }
  return "muted";
}

function coverageStatusLabel(status: CoverageStatus): string {
  return status === "empty" ? "Empty chain" : "Partial chain";
}

function coverageStatusMessage(status: CoverageStatus): string {
  return status === "empty" ? "Option chain coverage is empty." : "Option chain coverage is partial.";
}

function transportStatusMessage(status: LiveTransportStatus): string {
  if (status === "fallback_polling") {
    return "WebSocket unavailable; polling is keeping the dashboard updated.";
  }
  if (status === "disconnected") {
    return "WebSocket stream disconnected.";
  }
  if (status === "reconnecting") {
    return "Attempting to reconnect the WebSocket stream.";
  }
  return "Opening WebSocket stream.";
}

function countCalcIssues(rows: AnalyticsRow[]): Map<CalcStatus, number> {
  const counts = new Map<CalcStatus, number>();
  for (const row of rows) {
    if (row.calc_status === "ok") {
      continue;
    }
    counts.set(row.calc_status, (counts.get(row.calc_status) ?? 0) + 1);
  }
  return counts;
}

function formatCalcIssueSummary(counts: Map<CalcStatus, number>): string {
  return [...counts.entries()]
    .map(([status, count]) => `${formatOperationalStatusLabel(status)}: ${count}`)
    .join("; ")
    .concat(".");
}

function dedupeNotices(notices: OperationalNotice[]): OperationalNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    if (seen.has(notice.key)) {
      return false;
    }
    seen.add(notice.key);
    return true;
  });
}
