"use client";

import React, { useState } from "react";
import type { CSSProperties } from "react";
import { DashboardChart } from "./DashboardChart";
import type { AnalyticsSnapshot } from "../lib/contracts";
import {
  type ChainSide,
  filterChainRowsBySide,
  formatInteger,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSnapshotTime,
  formatStatusLabel,
  formatStrikeRange,
  groupRowsByStrike,
  nearestStrike,
  sortRowsByStrike,
  summarizeSnapshot
} from "../lib/dashboardMetrics";

interface DashboardViewProps {
  snapshot: AnalyticsSnapshot;
  initialChainSide?: ChainSide;
  replayPanel?: React.ReactNode;
  savedViewsPanel?: React.ReactNode;
  scenarioPanel?: React.ReactNode;
}

const chainFilterOptions: Array<{ side: ChainSide; label: string }> = [
  { side: "all", label: "All" },
  { side: "calls", label: "Calls" },
  { side: "puts", label: "Puts" }
];

export function DashboardView({
  snapshot,
  initialChainSide = "all",
  replayPanel,
  savedViewsPanel,
  scenarioPanel
}: DashboardViewProps) {
  const [chainSide, setChainSide] = useState<ChainSide>(initialChainSide);
  const summary = summarizeSnapshot(snapshot);
  const rows = sortRowsByStrike(snapshot.rows);
  const chainRows = groupRowsByStrike(rows);
  const visibleChainRows = filterChainRowsBySide(chainRows, chainSide);
  const showCalls = chainSide === "all" || chainSide === "calls";
  const showPuts = chainSide === "all" || chainSide === "puts";
  const atmStrike = nearestStrike(snapshot);
  const maxGamma = Math.max(0, ...rows.map((row) => Math.abs(row.custom_gamma ?? 0)));
  const maxOpenInterest = Math.max(0, ...rows.map((row) => row.open_interest ?? 0));

  return (
    <main className="dashboardShell">
      <header className="topBar">
        <div className="brandLockup">
          <div className="scopeMark" aria-hidden="true" />
          <div>
            <h1>GammaScope</h1>
            <p>SPX 0DTE analytics</p>
          </div>
        </div>
        <div className="statusRail" aria-label="Session status">
          <span>{formatStatusLabel(snapshot.mode)}</span>
          <span>{formatStatusLabel(snapshot.source_status)}</span>
          <span>{snapshot.freshness_ms} ms</span>
        </div>
      </header>

      <section className="sessionBand" aria-label="Current replay session">
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
        <Metric label="Abs gamma" value={formatNumber(summary.totalAbsGamma, 4)} />
        <Metric label="Abs vanna" value={formatNumber(summary.totalAbsVanna, 4)} />
      </section>

      <section className="chartGrid" aria-label="Analytics charts">
        <DashboardChart rows={rows} title="IV smile" metricKey="custom_iv" tone="blue" valueKind="percent" />
        <DashboardChart rows={rows} title="Gamma by strike" metricKey="custom_gamma" tone="violet" valueKind="decimal" />
        <DashboardChart rows={rows} title="Vanna by strike" metricKey="custom_vanna" tone="teal" valueKind="decimal" />
      </section>

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
                      <td className="smallOptional">{formatPercent(row.call?.custom_iv)}</td>
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
                      <td className="smallOptional">{formatPercent(row.put?.custom_iv)}</td>
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
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
    <td className={`riskCell ${side}Risk`} style={style}>
      <span className="heatFill" aria-hidden="true" />
      <span>{formatNumber(gamma, 5)}</span>
    </td>
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
