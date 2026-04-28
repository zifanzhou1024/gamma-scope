"use client";

import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ChartInspectionBar } from "./ChartInspectionBar";
import { DashboardChart } from "./DashboardChart";
import { DataQualityPanel } from "./DataQualityPanel";
import { LevelMovementPanel } from "./LevelMovementPanel";
import { SourceSelector } from "./SourceSelector";
import { ThemeToggle } from "./ThemeToggle";
import type { AnalyticsSnapshot } from "../lib/contracts";
import type { CollectorHealth } from "../lib/clientCollectorStatusSource";
import { deriveStrikeInspection } from "../lib/chartInspection";
import type { DataSourcePreference } from "../lib/sourcePreference";
import { DEFAULT_DATA_SOURCE, formatDataSourcePreference } from "../lib/sourcePreference";
import {
  type ChainSide,
  type LiveTransportStatus,
  deriveLevelHistoryEntry,
  deriveLevelMovements,
  deriveOperationalNotices,
  deriveMarketIntelligence,
  deriveMarketMap,
  filterChainRowsBySide,
  filterRowsToSpotCenteredStrikeWindow,
  formatGammaDiff,
  formatInteger,
  formatIvDiffBasisPoints,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSnapshotTime,
  formatStatusLabel,
  formatStrikeRange,
  getAtmMetricValue,
  getRowOperationalStatusDisplays,
  getTransportStatusDisplay,
  getComparisonStatusDisplay,
  groupRowsByStrike,
  nearestStrike,
  sortRowsByStrike,
  summarizeSnapshot,
  updateLevelHistory
} from "../lib/dashboardMetrics";

interface DashboardViewProps {
  snapshot: AnalyticsSnapshot;
  chainSnapshot?: AnalyticsSnapshot;
  collectorHealth?: CollectorHealth | null;
  transportStatus?: LiveTransportStatus | null;
  initialChainSide?: ChainSide;
  activeDashboard?: "realtime" | "replay";
  selectedDataSource?: DataSourcePreference;
  onSelectedDataSourceChange?: (value: DataSourcePreference) => void;
  adminUtility?: React.ReactNode;
  replayPanel?: React.ReactNode;
  savedViewsPanel?: React.ReactNode;
  scenarioPanel?: React.ReactNode;
}

const chainFilterOptions: Array<{ side: ChainSide; label: string }> = [
  { side: "all", label: "All" },
  { side: "calls", label: "Calls" },
  { side: "puts", label: "Puts" }
];

const IV_CHART_STRIKE_LEVELS_EACH_SIDE = 20;

export function DashboardView({
  snapshot,
  chainSnapshot,
  collectorHealth,
  transportStatus,
  initialChainSide = "all",
  activeDashboard = "realtime",
  selectedDataSource = DEFAULT_DATA_SOURCE,
  onSelectedDataSourceChange = () => undefined,
  adminUtility,
  replayPanel,
  savedViewsPanel,
  scenarioPanel
}: DashboardViewProps) {
  const [inspectedStrike, setInspectedStrike] = useState<number | null>(null);
  const [levelHistory, setLevelHistory] = useState(() => [deriveLevelHistoryEntry(snapshot, activeDashboard)]);
  const summary = summarizeSnapshot(snapshot);
  const rows = sortRowsByStrike(snapshot.rows);
  const sharedStrikeDomain = deriveSharedStrikeDomain(rows);
  const ivRows = filterRowsToSpotCenteredStrikeWindow(rows, snapshot.spot, IV_CHART_STRIKE_LEVELS_EACH_SIDE);
  const ivSharedStrikeDomain = deriveSharedStrikeDomain(ivRows);
  const totalChartStrikeCount = countDistinctStrikes(rows);
  const ivChartStrikeCount = countDistinctStrikes(ivRows);
  const ivStrikeCountLabel =
    ivChartStrikeCount < totalChartStrikeCount ? `${ivChartStrikeCount} of ${totalChartStrikeCount} strikes` : undefined;
  const inspection = deriveStrikeInspection(rows, inspectedStrike, snapshot.spot);
  const marketMap = deriveMarketMap(snapshot);
  const marketIntelligence = deriveMarketIntelligence(snapshot);
  const levelMovements = deriveLevelMovements(levelHistory);
  const atmIv = getAtmMetricValue(snapshot, "custom_iv");
  const atmGamma = getAtmMetricValue(snapshot, "custom_gamma");
  const atmVanna = getAtmMetricValue(snapshot, "custom_vanna");
  const transportDisplay = transportStatus ? getTransportStatusDisplay(transportStatus) : null;
  const operationalNotices = deriveOperationalNotices(snapshot, collectorHealth, transportStatus);
  const handleInspectStrike = (strike: number) => setInspectedStrike(strike);
  const handleClearInspection = () => setInspectedStrike(null);

  useEffect(() => {
    setLevelHistory((history) => updateLevelHistory(history, deriveLevelHistoryEntry(snapshot, activeDashboard), 12));
  }, [activeDashboard, snapshot]);

  return (
    <main className="dashboardShell">
      <header className="topBar">
        <div className="topBarPrimary">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>SPX 0DTE analytics</p>
            </div>
          </div>
          <nav className="topNavTabs" aria-label="Dashboard views">
            <a
              className={`topNavTab${activeDashboard === "realtime" ? " topNavTab-active" : ""}`}
              href="/"
              aria-current={activeDashboard === "realtime" ? "page" : undefined}
            >
              Realtime
            </a>
            <a
              className={`topNavTab${activeDashboard === "replay" ? " topNavTab-active" : ""}`}
              href="/replay"
              aria-current={activeDashboard === "replay" ? "page" : undefined}
            >
              Replay
            </a>
            <a className="topNavTab" href="/heatmap">
              Heatmap
            </a>
          </nav>
        </div>
        <div className="topBarUtility">
          <SourceSelector value={selectedDataSource} onChange={onSelectedDataSourceChange} />
          <ThemeToggle />
          <div className="sourcePreferenceLabel" aria-label="Preferred data source">
            Preferred {formatDataSourcePreference(selectedDataSource)}
          </div>
          <div className="statusRail" aria-label="Session status">
            <span>{formatStatusLabel(snapshot.mode)}</span>
            <span>{formatStatusLabel(snapshot.source_status)}</span>
            <span>{snapshot.freshness_ms} ms</span>
            {transportDisplay ? (
              <span className={`transportStatus transportStatus-${transportDisplay.tone}`}>
                Transport {transportDisplay.label}
              </span>
            ) : null}
            {collectorHealth ? (
              <>
                <span className={`collectorStatus collectorStatus-${collectorHealth.status}`}>
                  Collector {formatStatusLabel(collectorHealth.status)}
                </span>
                <span>IBKR {formatAccountMode(collectorHealth.ibkr_account_mode)}</span>
                <span className="collectorMessage" title={collectorHealth.message}>
                  {collectorHealth.message}
                </span>
              </>
            ) : null}
          </div>
          {adminUtility}
        </div>
      </header>

      <section className="sessionBand" aria-label="Current session">
        <div>
          <span className="eyebrow">Session</span>
          <strong>{snapshot.session_id}</strong>
        </div>
        <div>
          <span className="eyebrow">Snapshot</span>
          <strong>{formatSnapshotTime(snapshot.snapshot_time)}</strong>
        </div>
        <div>
          <span className="eyebrow">Coverage</span>
          <strong>{formatStatusLabel(snapshot.coverage_status)}</strong>
        </div>
        <div>
          <span className="eyebrow">Expiry</span>
          <strong>{snapshot.expiry}</strong>
        </div>
      </section>

      <DataQualityPanel
        snapshot={snapshot}
        collectorHealth={collectorHealth}
        transportStatus={transportStatus}
        activeDashboard={activeDashboard}
      />

      {operationalNotices.length > 0 ? (
        <section className="operationalNotices" aria-label="Operational notices">
          {operationalNotices.map((notice) => (
            <div key={notice.key} className={`operationalNotice operationalNotice-${notice.tone}`}>
              <strong>{notice.label}</strong>
              <span>{notice.message}</span>
            </div>
          ))}
        </section>
      ) : null}

      {replayPanel || savedViewsPanel || scenarioPanel ? (
        <section className="dashboardControls" aria-label="Dashboard controls">
          {replayPanel}
          {savedViewsPanel}
          {scenarioPanel}
        </section>
      ) : null}

      <section className="kpiGrid" aria-label="Selected metrics">
        <Metric label="SPX spot" value={formatPrice(snapshot.spot)} />
        <Metric label="Forward" value={formatPrice(snapshot.forward)} />
        <Metric label="Strike range" value={formatStrikeRange(summary.strikeRange)} />
        <Metric label="Average IV" value={formatPercent(summary.averageIv)} />
        <Metric label="Net gamma" value={formatNumber(summary.totalNetGamma, 4)} />
        <Metric label="Abs gamma" value={formatNumber(summary.totalAbsGamma, 4)} />
        <Metric label="Net vanna" value={formatNumber(summary.totalNetVanna, 4)} />
        <Metric label="Abs vanna" value={formatNumber(summary.totalAbsVanna, 4)} />
      </section>

      <MarketMapPanel marketMap={marketMap} />
      <MarketIntelligencePanel intelligence={marketIntelligence} />
      <LevelMovementPanel movements={levelMovements} historyCount={levelHistory.length} />

      <section className="chartGrid" aria-label="Analytics charts">
        <DashboardChart
          rows={ivRows}
          title="IV BY STRIKE"
          metricKey="custom_iv"
          tone="blue"
          valueKind="percent"
          spot={snapshot.spot}
          forward={snapshot.forward}
          atmValue={atmIv}
          sharedStrikeDomain={ivSharedStrikeDomain}
          strikeCountLabel={ivStrikeCountLabel}
          inspectedStrike={inspectedStrike}
          inspection={inspection}
          onInspectStrike={handleInspectStrike}
          onClearInspection={handleClearInspection}
        />
        <DashboardChart
          rows={rows}
          title="GAMMA BY STRIKE"
          metricKey="custom_gamma"
          tone="violet"
          valueKind="decimal"
          spot={snapshot.spot}
          forward={snapshot.forward}
          atmValue={atmGamma}
          sharedStrikeDomain={sharedStrikeDomain}
          inspectedStrike={inspectedStrike}
          inspection={inspection}
          onInspectStrike={handleInspectStrike}
          onClearInspection={handleClearInspection}
        />
        <DashboardChart
          rows={rows}
          title="VANNA BY STRIKE"
          metricKey="custom_vanna"
          tone="teal"
          valueKind="decimal"
          spot={snapshot.spot}
          forward={snapshot.forward}
          atmValue={atmVanna}
          sharedStrikeDomain={sharedStrikeDomain}
          showZeroLine
          inspectedStrike={inspectedStrike}
          inspection={inspection}
          onInspectStrike={handleInspectStrike}
          onClearInspection={handleClearInspection}
        />
      </section>

      {inspection ? <ChartInspectionBar inspection={inspection} onClear={handleClearInspection} /> : null}

      <OptionChainSection snapshot={chainSnapshot ?? snapshot} initialChainSide={initialChainSide} />
    </main>
  );
}

const OptionChainSection = React.memo(function OptionChainSection({
  snapshot,
  initialChainSide
}: {
  snapshot: AnalyticsSnapshot;
  initialChainSide: ChainSide;
}) {
  const [chainSide, setChainSide] = useState<ChainSide>(initialChainSide);
  const rows = sortRowsByStrike(snapshot.rows);
  const chainRows = groupRowsByStrike(rows);
  const visibleChainRows = filterChainRowsBySide(chainRows, chainSide);
  const showCalls = chainSide === "all" || chainSide === "calls";
  const showPuts = chainSide === "all" || chainSide === "puts";
  const atmStrike = nearestStrike(snapshot);
  const maxGamma = Math.max(0, ...rows.map((row) => Math.abs(row.custom_gamma ?? 0)));
  const maxOpenInterest = Math.max(0, ...rows.map((row) => row.open_interest ?? 0));

  return (
    <section className="chainSection" aria-label="Option chain">
      <div className="chainToolbar">
        <div className="chainTitle">
          <h2>Option chain</h2>
          <p>Gamma heat and OI are mirrored around the strike spine.</p>
        </div>
        <div className="chainFilters" aria-label="Chain filters">
          {chainFilterOptions.map((option) => (
            <button
              key={option.side}
              type="button"
              className={`filterChip${chainSide === option.side ? " filter-active" : ""}`}
              aria-pressed={chainSide === option.side}
              onClick={() => setChainSide(option.side)}
            >
              <span aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
        <div className="chainLegend" aria-label="Chain legend">
          <span><i className="atmDot" />ATM</span>
          <span><i className="gammaDot" />Gamma heat</span>
          <strong>{chainRows.length} strikes</strong>
        </div>
      </div>
      <div className="chainTableWrap">
        <table className={`chainTable chainTable-${chainSide}`}>
          <thead>
            <tr>
              {showCalls ? (
                <>
                  <th className="callCol compactOptional">Call bid</th>
                  <th className="callCol compactOptional">Call ask</th>
                  <th className="callCol">Call mid</th>
                  <th className="callCol smallOptional">Call IV</th>
                  <th className="callCol">Call Γ</th>
                  <th className="callCol">Call OI</th>
                </>
              ) : null}
              <th className="strikeCol">Strike</th>
              {showPuts ? (
                <>
                  <th className="putCol compactOptional">Put bid</th>
                  <th className="putCol compactOptional">Put ask</th>
                  <th className="putCol">Put mid</th>
                  <th className="putCol smallOptional">Put IV</th>
                  <th className="putCol">Put Γ</th>
                  <th className="putCol">Put OI</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleChainRows.map((row) => (
              <tr key={row.strike} className={row.strike === atmStrike ? "atmRow" : undefined}>
                {showCalls ? (
                  <>
                    <td className="compactOptional">{formatPrice(row.call?.bid)}</td>
                    <td className="compactOptional">{formatPrice(row.call?.ask)}</td>
                    <td>{formatPrice(row.call?.mid)}</td>
                    <IvCell row={row.call} />
                    <RiskCell row={row.call} maxGamma={maxGamma} side="call" />
                    <InterestCell value={row.call?.open_interest} maxOpenInterest={maxOpenInterest} side="call" />
                  </>
                ) : null}
                <td className="strikeCol">
                  <strong>{formatPrice(row.strike)}</strong>
                  <span>{formatStrikeDistance(row.strike, snapshot.spot, atmStrike)}</span>
                </td>
                {showPuts ? (
                  <>
                    <td className="compactOptional">{formatPrice(row.put?.bid)}</td>
                    <td className="compactOptional">{formatPrice(row.put?.ask)}</td>
                    <td>{formatPrice(row.put?.mid)}</td>
                    <IvCell row={row.put} />
                    <RiskCell row={row.put} maxGamma={maxGamma} side="put" />
                    <InterestCell value={row.put?.open_interest} maxOpenInterest={maxOpenInterest} side="put" />
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});

function deriveSharedStrikeDomain(rows: AnalyticsSnapshot["rows"]): [number, number] | null {
  if (rows.length === 0) {
    return null;
  }
  const strikes = rows.map((row) => row.strike);
  return [Math.min(...strikes), Math.max(...strikes)];
}

function countDistinctStrikes(rows: AnalyticsSnapshot["rows"]): number {
  return new Set(rows.map((row) => row.strike)).size;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MarketMapPanel({ marketMap }: { marketMap: ReturnType<typeof deriveMarketMap> }) {
  return (
    <section className="marketMapPanel" aria-label="Market map">
      <div className="sectionHeader">
        <div>
          <h2>MARKET MAP</h2>
          <p>Spot-relative strikes and exposure inflection points.</p>
        </div>
      </div>
      <div className="marketMapGrid">
        <MarketMapItem level="spot" label="Spot" value={formatPrice(marketMap.spot)} detail="Current index level" tone="spot" />
        <MarketMapItem
          level="forward"
          label="Forward"
          value={formatPrice(marketMap.forward)}
          detail="Implied forward level"
          tone="forward"
        />
        <MarketMapItem
          level="atm-strike"
          label="ATM strike"
          value={formatPrice(marketMap.atmStrike)}
          detail="Nearest listed strike"
          tone="spot"
        />
        <MarketMapItem
          level="call-iv-low"
          label="Call IV low"
          value={formatMarketLevel(marketMap.callIvLow, "percent")}
          detail={formatMarketStrike(marketMap.callIvLow)}
          side="call"
        />
        <MarketMapItem
          level="put-iv-low"
          label="Put IV low"
          value={formatMarketLevel(marketMap.putIvLow, "percent")}
          detail={formatMarketStrike(marketMap.putIvLow)}
          side="put"
        />
        <MarketMapItem
          level="gamma-peak"
          label="Gamma peak"
          value={formatMarketLevel(marketMap.gammaPeak, "decimal")}
          detail={formatMarketStrike(marketMap.gammaPeak)}
          tone="gamma"
        />
        <MarketMapItem
          level="vanna-flip"
          label={vannaFlipLabel(marketMap.vannaFlip)}
          value={formatMarketStrike(marketMap.vannaFlip)}
          detail={formatVannaFlipDetail(marketMap.vannaFlip)}
          tone="vanna"
        />
        <MarketMapItem
          level="vanna-max"
          label="Vanna max"
          value={formatMarketLevel(marketMap.vannaMax, "decimal")}
          detail={formatMarketStrike(marketMap.vannaMax)}
          tone="vanna"
        />
      </div>
    </section>
  );
}

function MarketMapItem({
  level,
  label,
  value,
  detail,
  side,
  tone
}: {
  level: string;
  label: string;
  value: string;
  detail: string;
  side?: "call" | "put";
  tone?: "spot" | "forward" | "gamma" | "vanna";
}) {
  const modifier = side ? ` marketMapItem-${side}` : tone ? ` marketMapItem-${tone}` : "";

  return (
    <div className={`marketMapItem${modifier}`} data-market-map-level={level}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MarketIntelligencePanel({ intelligence }: { intelligence: ReturnType<typeof deriveMarketIntelligence> }) {
  return (
    <section className="marketIntelligencePanel" aria-label="Market intelligence">
      <div className="sectionHeader">
        <div>
          <h2>MARKET INTELLIGENCE</h2>
          <p>Expected ranges, walls, and regime labels from the current snapshot.</p>
        </div>
      </div>
      <div className="marketIntelligenceGrid">
        <MarketIntelligenceItem
          label="0.5σ range"
          value={formatExpectedMoveRange(intelligence.expectedMove.halfSigma.range)}
          detail={formatExpectedMoveDetail(intelligence.expectedMove.halfSigma.move)}
          tone="move"
        />
        <MarketIntelligenceItem
          label="1σ range"
          value={formatExpectedMoveRange(intelligence.expectedMove.oneSigma.range)}
          detail={formatExpectedMoveDetail(intelligence.expectedMove.oneSigma.move)}
          tone="move"
        />
        <MarketIntelligenceItem
          label="Positive gamma wall"
          value={formatMarketStrikeValue(intelligence.walls.positiveGamma)}
          detail={formatGexWallDetail(intelligence.walls.positiveGamma)}
          tone="gamma"
        />
        <MarketIntelligenceItem
          label="Negative gamma wall"
          value={formatMarketStrikeValue(intelligence.walls.negativeGamma)}
          detail={formatGexWallDetail(intelligence.walls.negativeGamma)}
          tone="gamma"
        />
        <MarketIntelligenceItem
          label="Vanna wall"
          value={formatMarketStrikeValue(intelligence.walls.vanna)}
          detail={formatMarketLevel(intelligence.walls.vanna, "decimal")}
          tone="vanna"
        />
        <MarketIntelligenceItem label="Gamma regime" value={intelligence.regimes.gamma} detail="Net gamma / abs gamma" />
        <MarketIntelligenceItem label="Vanna regime" value={intelligence.regimes.vanna} detail="Net vanna / abs vanna" />
        <MarketIntelligenceItem label="IV smile bias" value={intelligence.regimes.ivSmileBias} detail="Below spot vs above spot" />
      </div>
    </section>
  );
}

function MarketIntelligenceItem({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "move" | "gamma" | "vanna";
}) {
  const modifier = tone ? ` marketIntelligenceItem-${tone}` : "";

  return (
    <div className={`marketIntelligenceItem${modifier}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function formatMarketLevel(
  level: ReturnType<typeof deriveMarketMap>["callIvLow"],
  valueKind: "percent" | "decimal"
): string {
  if (level == null) {
    return "—";
  }

  return valueKind === "percent" ? formatPercent(level.value) : formatNumber(level.value, 4);
}

function formatGexWallDetail(level: ReturnType<typeof deriveMarketMap>["callIvLow"]): string {
  if (level == null) {
    return "—";
  }

  const magnitude = Math.abs(level.value);
  const prefix = level.value < 0 ? "-$" : "$";
  if (magnitude >= 1_000_000_000) {
    return `${prefix}${(magnitude / 1_000_000_000).toFixed(1)}B / 1%`;
  }
  if (magnitude >= 1_000_000) {
    return `${prefix}${(magnitude / 1_000_000).toFixed(1)}M / 1%`;
  }
  if (magnitude >= 1_000) {
    return `${prefix}${(magnitude / 1_000).toFixed(1)}K / 1%`;
  }
  return `${prefix}${magnitude.toFixed(0)} / 1%`;
}

function formatMarketStrike(level: ReturnType<typeof deriveMarketMap>["callIvLow"]): string {
  if (level == null) {
    return "—";
  }

  return `${formatPrice(level.strike)} strike`;
}

function formatMarketStrikeValue(level: ReturnType<typeof deriveMarketMap>["callIvLow"]): string {
  if (level == null) {
    return "—";
  }

  return formatPrice(level.strike);
}

function formatExpectedMoveRange(range: [number, number] | null): string {
  if (range == null) {
    return "—";
  }

  return `${formatPrice(range[0])}–${formatPrice(range[1])}`;
}

function formatExpectedMoveDetail(move: number | null): string {
  if (move == null) {
    return "Move unavailable";
  }

  return `±${formatPrice(move)} pts`;
}

function vannaFlipLabel(level: ReturnType<typeof deriveMarketMap>["vannaFlip"]): string {
  return level?.source === "nearest_zero" ? "Vanna nearest zero" : "Vanna flip";
}

function formatVannaFlipDetail(level: ReturnType<typeof deriveMarketMap>["vannaFlip"]): string {
  if (level == null) {
    return "—";
  }
  if (level.source === "nearest_zero") {
    return `Nearest zero value ${formatMarketLevel(level, "decimal")}`;
  }
  return formatMarketLevel(level, "decimal");
}

function formatAccountMode(accountMode: CollectorHealth["ibkr_account_mode"]): string {
  if (accountMode === "unknown") {
    return "Unknown";
  }

  return formatStatusLabel(accountMode);
}

function IvCell({ row }: { row: AnalyticsSnapshot["rows"][number] | null | undefined }) {
  return (
    <td className="smallOptional comparisonCell">
      <span className="cellMain">{formatPercent(row?.custom_iv)}</span>
      <OperationalLine row={row} />
      <ComparisonLine
        row={row}
        hasComparisonValue={row?.ibkr_iv != null || row?.iv_diff != null}
        ibkrValue={formatPercent(row?.ibkr_iv)}
        diffValue={formatIvDiffBasisPoints(row?.iv_diff)}
      />
    </td>
  );
}

function OperationalLine({ row }: { row: AnalyticsSnapshot["rows"][number] | null | undefined }) {
  const statuses = getRowOperationalStatusDisplays(row);

  if (statuses.length === 0) {
    return null;
  }

  return (
    <span className="operationalLine">
      {statuses.map((status) => (
        <span key={status.label} className={`operationalPill operationalPill-${status.tone}`}>
          {status.label}
        </span>
      ))}
    </span>
  );
}

function RiskCell({
  row,
  maxGamma,
  side
}: {
  row: AnalyticsSnapshot["rows"][number] | null | undefined;
  maxGamma: number;
  side: "call" | "put";
}) {
  const gamma = row?.custom_gamma ?? null;
  const intensity = gamma == null || maxGamma === 0 ? 0 : Math.min(1, Math.abs(gamma) / maxGamma);
  const style = {
    "--heat": intensity.toFixed(3),
    "--heat-opacity": (0.14 + intensity * 0.55).toFixed(3)
  } as CSSProperties;

  return (
    <td className={`riskCell comparisonCell ${side}Risk`} style={style}>
      <span className="heatFill" aria-hidden="true" />
      <span className="cellMain">{formatNumber(gamma, 5)}</span>
      <ComparisonLine
        row={row}
        hasComparisonValue={row?.ibkr_gamma != null || row?.gamma_diff != null}
        ibkrValue={formatNumber(row?.ibkr_gamma, 5)}
        diffValue={formatGammaDiff(row?.gamma_diff)}
      />
    </td>
  );
}

function ComparisonLine({
  row,
  hasComparisonValue,
  ibkrValue,
  diffValue
}: {
  row: AnalyticsSnapshot["rows"][number] | null | undefined;
  hasComparisonValue: boolean;
  ibkrValue: string;
  diffValue: string;
}) {
  if (row == null) {
    return null;
  }

  const status = getComparisonStatusDisplay(row.comparison_status);

  if (status.tone !== "ok" || !hasComparisonValue) {
    return (
      <span className="comparisonLine">
        <span className={`comparisonPill comparison-${status.tone}`}>{status.label}</span>
      </span>
    );
  }

  return (
    <span className="comparisonLine">
      {ibkrValue !== "—" ? <span className="comparisonIbkr">IBKR {ibkrValue}</span> : null}
      {diffValue !== "—" ? <span className="comparisonPill comparison-ok">{diffValue}</span> : null}
    </span>
  );
}

function InterestCell({
  value,
  maxOpenInterest,
  side
}: {
  value: number | null | undefined;
  maxOpenInterest: number;
  side: "call" | "put";
}) {
  const intensity = value == null || maxOpenInterest === 0 ? 0 : Math.min(1, value / maxOpenInterest);
  const style = {
    "--oi": intensity.toFixed(3)
  } as CSSProperties;

  return (
    <td className={`oiCell ${side}Interest`} style={style}>
      <span className="oiBar" aria-hidden="true" />
      <span>{formatInteger(value)}</span>
    </td>
  );
}

function formatStrikeDistance(strike: number, spot: number, atmStrike: number | null): string {
  if (strike === atmStrike) {
    return "ATM";
  }
  const distance = strike - spot;
  return `${distance > 0 ? "+" : ""}${Math.round(distance)} pts`;
}
