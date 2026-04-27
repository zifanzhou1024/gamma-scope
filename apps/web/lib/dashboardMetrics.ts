import type { AnalyticsSnapshot } from "./contracts";
import type { CollectorHealth } from "./clientCollectorStatusSource";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];
type CalcStatus = AnalyticsRow["calc_status"];
type ComparisonStatus = AnalyticsRow["comparison_status"];
type SourceStatus = AnalyticsSnapshot["source_status"];
type CoverageStatus = AnalyticsSnapshot["coverage_status"];
type CollectorStatus = CollectorHealth["status"];

const REGIME_RATIO_THRESHOLD = 0.2;
const IV_SMILE_BIAS_THRESHOLD = 0.01;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

export type ComparisonTone = "ok" | "warning" | "muted";
export type OperationalTone = "ok" | "warning" | "error" | "muted";
export type LiveTransportStatus = "connecting" | "streaming" | "disconnected" | "fallback_polling" | "reconnecting";
export type DashboardSurface = "realtime" | "replay";

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
  totalNetGamma: number;
  totalAbsGamma: number;
  totalNetVanna: number;
  totalAbsVanna: number;
}

export interface DataQualitySummary {
  lastUpdated: string;
  expiry: string;
  isZeroDte: boolean;
  zeroDteLabel: string;
  rowCount: number;
  distinctStrikeCount: number;
  freshness: OperationalStatusDisplay;
  source: OperationalStatusDisplay;
  coverage: OperationalStatusDisplay;
  transport: OperationalStatusDisplay | null;
  collector: (OperationalStatusDisplay & { detail: string }) | null;
  qualitySummary: {
    validQuoteRows: number;
    crossedQuoteRows: number;
    missingBidAskRows: number;
    nonOkCalcRows: number;
  };
  mode: OperationalStatusDisplay & { detail: string };
}

export interface MarketLevel {
  strike: number;
  value: number;
  source?: "crossing" | "nearest_zero";
}

export interface MarketMap {
  spot: number;
  forward: number;
  atmStrike: number | null;
  callIvLow: MarketLevel | null;
  putIvLow: MarketLevel | null;
  gammaPeak: MarketLevel | null;
  vannaFlip: MarketLevel | null;
  vannaMax: MarketLevel | null;
}

export type GammaRegime = "Pinning" | "Trending" | "Unstable";
export type VannaRegime = "Supportive" | "Suppressive" | "Mixed";
export type IvSmileBias = "Left-skew" | "Right-skew" | "Balanced";

export interface ExpectedMoveBand {
  move: number | null;
  range: [number, number] | null;
}

export interface MarketIntelligence {
  expectedMove: {
    iv: number | null;
    timeToCloseYears: number;
    halfSigma: ExpectedMoveBand;
    oneSigma: ExpectedMoveBand;
  };
  walls: {
    positiveGamma: MarketLevel | null;
    negativeGamma: MarketLevel | null;
    vanna: MarketLevel | null;
  };
  regimes: {
    gamma: GammaRegime;
    vanna: VannaRegime;
    ivSmileBias: IvSmileBias;
  };
}

export type LevelMovementDirection = "Up" | "Down" | "Flat" | "Unavailable";
export type LevelHistoryKey =
  | "spot"
  | "callIvLowStrike"
  | "putIvLowStrike"
  | "gammaPeakStrike"
  | "vannaFlipStrike";

export interface LevelHistoryEntry {
  resetKey: string;
  snapshotTime: string;
  levels: Record<LevelHistoryKey, number | null>;
}

export interface LevelMovement {
  previous: number | null;
  current: number | null;
  delta: number | null;
  direction: LevelMovementDirection;
}

export type LevelMovements = Record<LevelHistoryKey, LevelMovement>;

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
    totalNetGamma: sum(gammaValues),
    totalAbsGamma: sumAbs(gammaValues),
    totalNetVanna: sum(vannaValues),
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

export function deriveDataQuality(
  snapshot: AnalyticsSnapshot,
  collectorHealth?: CollectorHealth | null,
  transportStatus?: LiveTransportStatus | null,
  activeDashboard: DashboardSurface = "realtime"
): DataQualitySummary {
  const missingBidAskRows = snapshot.rows.filter((row) => row.bid == null || row.ask == null).length;
  const crossedQuoteRows = snapshot.rows.filter(isCrossedQuote).length;
  const snapshotMarketDate = marketDate(snapshot.snapshot_time);
  const modeMatchesSurface =
    (snapshot.mode === "live" && activeDashboard === "realtime") ||
    (snapshot.mode === "replay" && activeDashboard === "replay");

  return {
    lastUpdated: formatSnapshotTime(snapshot.snapshot_time),
    expiry: snapshot.expiry,
    isZeroDte: snapshotMarketDate === snapshot.expiry,
    zeroDteLabel: snapshotMarketDate === snapshot.expiry ? "0DTE" : "Not 0DTE",
    rowCount: snapshot.rows.length,
    distinctStrikeCount: new Set(snapshot.rows.map((row) => row.strike)).size,
    freshness: getFreshnessDisplay(snapshot.freshness_ms),
    source: {
      label: `Source ${formatStatusLabel(snapshot.source_status).toLowerCase()}`,
      tone: snapshot.source_status === "connected" ? "ok" : sourceStatusTone(snapshot.source_status)
    },
    coverage: getCoverageDisplay(snapshot.coverage_status),
    transport: transportStatus ? prefixStatusDisplay("Transport", getTransportStatusDisplay(transportStatus)) : null,
    collector: collectorHealth
      ? {
          label: `Collector ${formatStatusLabel(collectorHealth.status)}`,
          detail: `IBKR ${formatCollectorAccountMode(collectorHealth.ibkr_account_mode)}`,
          tone: collectorHealth.status === "connected" ? "ok" : collectorStatusTone(collectorHealth.status)
        }
      : null,
    qualitySummary: {
      validQuoteRows: snapshot.rows.length - missingBidAskRows - crossedQuoteRows,
      crossedQuoteRows,
      missingBidAskRows,
      nonOkCalcRows: snapshot.rows.filter((row) => row.calc_status !== "ok").length
    },
    mode: {
      label: `${formatStatusLabel(snapshot.mode)} mode`,
      detail: `${formatStatusLabel(activeDashboard)} dashboard`,
      tone: modeMatchesSurface ? "ok" : "warning"
    }
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

function marketDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function getFreshnessDisplay(freshnessMs: number): OperationalStatusDisplay {
  const label = `${formatFreshnessDuration(freshnessMs)} ${freshnessMs <= 5_000 ? "fresh" : "stale"}`;
  if (freshnessMs <= 5_000) {
    return { label, tone: "ok" };
  }
  if (freshnessMs <= 30_000) {
    return { label, tone: "warning" };
  }
  return { label, tone: "error" };
}

function formatFreshnessDuration(freshnessMs: number): string {
  if (freshnessMs < 1_000) {
    return `${freshnessMs}ms`;
  }
  if (freshnessMs < 60_000) {
    return `${Number((freshnessMs / 1_000).toFixed(1))}s`;
  }
  return `${Number((freshnessMs / 60_000).toFixed(1))}m`;
}

function getCoverageDisplay(status: CoverageStatus): OperationalStatusDisplay {
  if (status === "full") {
    return { label: "Full chain", tone: "ok" };
  }
  return {
    label: coverageStatusLabel(status),
    tone: status === "empty" ? "error" : "warning"
  };
}

function prefixStatusDisplay(prefix: string, display: OperationalStatusDisplay): OperationalStatusDisplay {
  return {
    label: `${prefix} ${display.label}`,
    tone: display.tone
  };
}

function formatCollectorAccountMode(accountMode: CollectorHealth["ibkr_account_mode"]): string {
  if (accountMode === "unknown") {
    return "Unknown";
  }
  return formatStatusLabel(accountMode);
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

export function filterRowsToSpotCenteredStrikeWindow(
  rows: AnalyticsRow[],
  spot: number,
  levelsEachSide: number
): AnalyticsRow[] {
  if (rows.length === 0 || !Number.isFinite(spot) || levelsEachSide < 0) {
    return rows;
  }

  const sortedStrikes = [...new Set(rows.map((row) => row.strike))].sort((a, b) => a - b);
  const maxStrikeCount = levelsEachSide * 2 + 1;
  if (sortedStrikes.length <= maxStrikeCount) {
    return rows;
  }

  const atmIndex = sortedStrikes.reduce((nearestIndex, strike, index) => {
    const nearestStrikeDistance = Math.abs(sortedStrikes[nearestIndex]! - spot);
    const currentStrikeDistance = Math.abs(strike - spot);
    return currentStrikeDistance < nearestStrikeDistance ? index : nearestIndex;
  }, 0);
  let start = Math.max(0, atmIndex - levelsEachSide);
  let end = Math.min(sortedStrikes.length, atmIndex + levelsEachSide + 1);

  if (end - start < maxStrikeCount) {
    if (start === 0) {
      end = Math.min(sortedStrikes.length, maxStrikeCount);
    } else if (end === sortedStrikes.length) {
      start = Math.max(0, sortedStrikes.length - maxStrikeCount);
    }
  }

  const visibleStrikes = new Set(sortedStrikes.slice(start, end));
  return rows.filter((row) => visibleStrikes.has(row.strike));
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

export function deriveMarketMap(snapshot: AnalyticsSnapshot): MarketMap {
  const gammaLevels = aggregateByStrike(snapshot.rows, "custom_gamma");
  const vannaLevels = aggregateByStrike(snapshot.rows, "custom_vanna");

  return {
    spot: snapshot.spot,
    forward: snapshot.forward,
    atmStrike: nearestStrike(snapshot),
    callIvLow: findSideMinimum(snapshot.rows, "call", "custom_iv"),
    putIvLow: findSideMinimum(snapshot.rows, "put", "custom_iv"),
    gammaPeak: findLargestAbsLevel(gammaLevels),
    vannaFlip: findZeroCrossing(vannaLevels),
    vannaMax: findLargestValueLevel(vannaLevels)
  };
}

export function deriveLevelHistoryEntry(
  snapshot: AnalyticsSnapshot,
  activeDashboard: DashboardSurface = "realtime"
): LevelHistoryEntry {
  const marketMap = deriveMarketMap(snapshot);

  return {
    resetKey: [activeDashboard, snapshot.mode, snapshot.session_id, snapshot.expiry].join("|"),
    snapshotTime: snapshot.snapshot_time,
    levels: {
      spot: snapshot.spot,
      callIvLowStrike: marketMap.callIvLow?.strike ?? null,
      putIvLowStrike: marketMap.putIvLow?.strike ?? null,
      gammaPeakStrike: marketMap.gammaPeak?.strike ?? null,
      vannaFlipStrike: marketMap.vannaFlip?.strike ?? null
    }
  };
}

export function updateLevelHistory(
  history: LevelHistoryEntry[],
  nextEntry: LevelHistoryEntry,
  maxEntries = 12
): LevelHistoryEntry[] {
  const boundedMax = Math.max(1, maxEntries);
  const previousEntry = history.at(-1);

  if (previousEntry == null || previousEntry.resetKey !== nextEntry.resetKey) {
    return [nextEntry];
  }

  const nextHistory =
    previousEntry.snapshotTime === nextEntry.snapshotTime ? [...history.slice(0, -1), nextEntry] : [...history, nextEntry];

  return nextHistory.slice(-boundedMax);
}

export function deriveLevelMovements(history: LevelHistoryEntry[]): LevelMovements {
  const currentEntry = history.at(-1) ?? null;
  const previousEntry = history.length > 1 ? history.at(-2) ?? null : null;

  return {
    spot: deriveLevelMovement(previousEntry?.levels.spot ?? null, currentEntry?.levels.spot ?? null),
    callIvLowStrike: deriveLevelMovement(
      previousEntry?.levels.callIvLowStrike ?? null,
      currentEntry?.levels.callIvLowStrike ?? null
    ),
    putIvLowStrike: deriveLevelMovement(
      previousEntry?.levels.putIvLowStrike ?? null,
      currentEntry?.levels.putIvLowStrike ?? null
    ),
    gammaPeakStrike: deriveLevelMovement(
      previousEntry?.levels.gammaPeakStrike ?? null,
      currentEntry?.levels.gammaPeakStrike ?? null
    ),
    vannaFlipStrike: deriveLevelMovement(
      previousEntry?.levels.vannaFlipStrike ?? null,
      currentEntry?.levels.vannaFlipStrike ?? null
    )
  };
}

export function deriveMarketIntelligence(snapshot: AnalyticsSnapshot): MarketIntelligence {
  const gammaLevels = aggregateByStrike(snapshot.rows, "custom_gamma");
  const vannaLevels = aggregateByStrike(snapshot.rows, "custom_vanna");
  const iv = getAtmMetricValue(snapshot, "custom_iv") ?? average(compactNumbers(snapshot.rows.map((row) => row.custom_iv)));
  const timeToCloseYears = timeToSpxCloseYears(snapshot.snapshot_time, snapshot.expiry);

  return {
    expectedMove: {
      iv,
      timeToCloseYears,
      halfSigma: expectedMoveBand(snapshot.spot, iv, timeToCloseYears, 0.5),
      oneSigma: expectedMoveBand(snapshot.spot, iv, timeToCloseYears, 1)
    },
    walls: {
      positiveGamma: findLargestPositiveLevel(gammaLevels),
      negativeGamma: findLargestNegativeLevel(gammaLevels),
      vanna: findLargestAbsLevel(vannaLevels)
    },
    regimes: {
      gamma: deriveGammaRegime(compactNumbers(snapshot.rows.map((row) => row.custom_gamma))),
      vanna: deriveVannaRegime(compactNumbers(snapshot.rows.map((row) => row.custom_vanna))),
      ivSmileBias: deriveIvSmileBias(snapshot)
    }
  };
}

export function getAtmMetricValue(
  snapshot: AnalyticsSnapshot,
  metricKey: "custom_iv" | "custom_gamma" | "custom_vanna"
): number | null {
  const atmStrike = nearestStrike(snapshot);
  if (atmStrike == null) {
    return null;
  }

  const values = compactNumbers(snapshot.rows.filter((row) => row.strike === atmStrike).map((row) => row[metricKey]));
  if (values.length === 0) {
    return null;
  }
  if (metricKey === "custom_iv") {
    return average(values);
  }
  return sum(values);
}

function compactNumbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value != null);
}

function deriveLevelMovement(previous: number | null, current: number | null): LevelMovement {
  if (previous == null || current == null) {
    return {
      previous,
      current,
      delta: null,
      direction: "Unavailable"
    };
  }

  const delta = current - previous;
  return {
    previous,
    current,
    delta,
    direction: delta > 0 ? "Up" : delta < 0 ? "Down" : "Flat"
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumAbs(values: number[]): number {
  return values.reduce((total, value) => total + Math.abs(value), 0);
}

function aggregateByStrike(rows: AnalyticsRow[], key: "custom_gamma" | "custom_vanna"): MarketLevel[] {
  const levels = new Map<number, number>();

  for (const row of rows) {
    const value = row[key];
    if (value == null) {
      continue;
    }
    levels.set(row.strike, (levels.get(row.strike) ?? 0) + value);
  }

  return [...levels.entries()]
    .map(([strike, value]) => ({ strike, value }))
    .sort((a, b) => a.strike - b.strike);
}

function findSideMinimum(
  rows: AnalyticsRow[],
  right: AnalyticsRow["right"],
  key: "custom_iv"
): MarketLevel | null {
  const levels = rows
    .filter((row) => row.right === right && row[key] != null)
    .map((row) => ({ strike: row.strike, value: row[key] as number }));

  if (levels.length === 0) {
    return null;
  }

  return levels.reduce((minimum, level) => (level.value < minimum.value ? level : minimum));
}

function findLargestAbsLevel(levels: MarketLevel[]): MarketLevel | null {
  if (levels.length === 0) {
    return null;
  }
  return levels.reduce((largest, level) => (Math.abs(level.value) >= Math.abs(largest.value) ? level : largest));
}

function findLargestPositiveLevel(levels: MarketLevel[]): MarketLevel | null {
  const positiveLevels = levels.filter((level) => level.value > 0);
  if (positiveLevels.length === 0) {
    return null;
  }
  return positiveLevels.reduce((largest, level) => (level.value > largest.value ? level : largest));
}

function findLargestNegativeLevel(levels: MarketLevel[]): MarketLevel | null {
  const negativeLevels = levels.filter((level) => level.value < 0);
  if (negativeLevels.length === 0) {
    return null;
  }
  return negativeLevels.reduce((largest, level) => (level.value < largest.value ? level : largest));
}

function findLargestValueLevel(levels: MarketLevel[]): MarketLevel | null {
  if (levels.length === 0) {
    return null;
  }
  return levels.reduce((largest, level) => (level.value >= largest.value ? level : largest));
}

function expectedMoveBand(spot: number, iv: number | null, timeToCloseYears: number, sigma: number): ExpectedMoveBand {
  if (iv == null) {
    return { move: null, range: null };
  }

  const clampedTimeToCloseYears = Number.isFinite(timeToCloseYears) ? Math.max(0, timeToCloseYears) : 0;
  const move = spot * iv * Math.sqrt(clampedTimeToCloseYears) * sigma;
  return {
    move,
    range: [spot - move, spot + move]
  };
}

function timeToSpxCloseYears(snapshotTime: string, expiry: string): number {
  const snapshotDate = new Date(snapshotTime);
  if (!isValidDate(snapshotDate)) {
    return 0;
  }

  const closeTime = marketCloseUtc(expiry);
  if (closeTime == null) {
    return 0;
  }

  const remainingMs = Math.max(0, closeTime.getTime() - snapshotDate.getTime());
  return remainingMs / MS_PER_YEAR;
}

function marketCloseUtc(expiry: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return null;
  }

  const [year, month, day] = expiry.split("-").map(Number);
  if (year == null || month == null || day == null) {
    return null;
  }

  const localCloseAsUtc = Date.UTC(year!, month! - 1, day!, 16, 0, 0, 0);
  if (!Number.isFinite(localCloseAsUtc)) {
    return null;
  }

  const expiryDate = new Date(localCloseAsUtc);
  if (
    expiryDate.getUTCFullYear() !== year ||
    expiryDate.getUTCMonth() !== month - 1 ||
    expiryDate.getUTCDate() !== day
  ) {
    return null;
  }

  let utcGuess = localCloseAsUtc;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), "America/New_York");
    if (offsetMs == null) {
      return null;
    }
    utcGuess = localCloseAsUtc - offsetMs;
  }

  const closeDate = new Date(utcGuess);
  return isValidDate(closeDate) ? closeDate : null;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number | null {
  if (!isValidDate(date)) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const localAsUtcParts = [
    Number(part("year")),
    Number(part("month")) - 1,
    Number(part("day")),
    Number(part("hour")),
    Number(part("minute")),
    Number(part("second"))
  ];
  if (localAsUtcParts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const localAsUtc = Date.UTC(
    localAsUtcParts[0]!,
    localAsUtcParts[1]!,
    localAsUtcParts[2]!,
    localAsUtcParts[3]!,
    localAsUtcParts[4]!,
    localAsUtcParts[5]!
  );

  return localAsUtc - date.getTime();
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function deriveGammaRegime(values: number[]): GammaRegime {
  const absGamma = sumAbs(values);
  if (absGamma === 0) {
    return "Unstable";
  }

  const ratio = sum(values) / absGamma;
  if (ratio > REGIME_RATIO_THRESHOLD) {
    return "Pinning";
  }
  if (ratio < -REGIME_RATIO_THRESHOLD) {
    return "Trending";
  }
  return "Unstable";
}

function deriveVannaRegime(values: number[]): VannaRegime {
  const absVanna = sumAbs(values);
  if (absVanna === 0) {
    return "Mixed";
  }

  const ratio = sum(values) / absVanna;
  if (ratio > REGIME_RATIO_THRESHOLD) {
    return "Supportive";
  }
  if (ratio < -REGIME_RATIO_THRESHOLD) {
    return "Suppressive";
  }
  return "Mixed";
}

function deriveIvSmileBias(snapshot: AnalyticsSnapshot): IvSmileBias {
  const leftAverage = average(compactNumbers(snapshot.rows.filter((row) => row.strike < snapshot.spot).map((row) => row.custom_iv)));
  const rightAverage = average(
    compactNumbers(snapshot.rows.filter((row) => row.strike > snapshot.spot).map((row) => row.custom_iv))
  );

  if (leftAverage == null || rightAverage == null) {
    return "Balanced";
  }

  if (leftAverage - rightAverage > IV_SMILE_BIAS_THRESHOLD) {
    return "Left-skew";
  }
  if (rightAverage - leftAverage > IV_SMILE_BIAS_THRESHOLD) {
    return "Right-skew";
  }
  return "Balanced";
}

function findZeroCrossing(levels: MarketLevel[]): MarketLevel | null {
  if (levels.length === 0) {
    return null;
  }

  const sortedLevels = [...levels].sort((a, b) => a.strike - b.strike);
  for (let index = 0; index < sortedLevels.length; index += 1) {
    const current = sortedLevels[index]!;
    if (current.value === 0) {
      return { strike: current.strike, value: 0, source: "crossing" };
    }

    const next = sortedLevels[index + 1];
    if (next == null || Math.sign(current.value) === Math.sign(next.value)) {
      continue;
    }

    const ratio = Math.abs(current.value) / (Math.abs(current.value) + Math.abs(next.value));
    return {
      strike: current.strike + (next.strike - current.strike) * ratio,
      value: 0,
      source: "crossing"
    };
  }

  const nearest = sortedLevels.reduce((closest, level) =>
    Math.abs(level.value) < Math.abs(closest.value) ? level : closest
  );
  return {
    strike: nearest.strike,
    value: nearest.value,
    source: "nearest_zero"
  };
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
