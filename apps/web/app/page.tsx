import { DashboardChart } from "../components/DashboardChart";
import {
  formatNumber,
  formatPercent,
  formatPrice,
  formatSnapshotTime,
  formatStatusLabel,
  formatStrikeRange,
  groupRowsByStrike,
  sortRowsByStrike,
  summarizeSnapshot
} from "../lib/dashboardMetrics";
import { seedSnapshot } from "../lib/seedSnapshot";

export default function Home() {
  const snapshot = seedSnapshot;
  const summary = summarizeSnapshot(snapshot);
  const rows = sortRowsByStrike(snapshot.rows);
  const chainRows = groupRowsByStrike(rows);

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
          <h2>Option chain</h2>
          <div className="chainFilters" aria-label="Chain filters">
            <span className="filterChip filter-active"><span />All</span>
            <span className="filterChip"><span />Calls</span>
            <span className="filterChip"><span />Puts</span>
          </div>
          <strong>{chainRows.length} strikes</strong>
        </div>
        <div className="chainTableWrap">
          <table className="chainTable">
            <thead>
              <tr>
                <th className="callCol">Call bid</th>
                <th className="callCol">Call ask</th>
                <th className="callCol">Call mid</th>
                <th className="callCol">Call IV</th>
                <th className="callCol">Call OI</th>
                <th className="strikeCol">Strike</th>
                <th className="putCol">Put bid</th>
                <th className="putCol">Put ask</th>
                <th className="putCol">Put mid</th>
                <th className="putCol">Put IV</th>
                <th className="putCol">Put OI</th>
              </tr>
            </thead>
            <tbody>
              {chainRows.map((row) => (
                <tr key={row.strike}>
                  <td>{formatPrice(row.call?.bid)}</td>
                  <td>{formatPrice(row.call?.ask)}</td>
                  <td>{formatPrice(row.call?.mid)}</td>
                  <td>{formatPercent(row.call?.custom_iv)}</td>
                  <td>{formatOpenInterest(row.call)}</td>
                  <td className="strikeCol">{formatPrice(row.strike)}</td>
                  <td>{formatPrice(row.put?.bid)}</td>
                  <td>{formatPrice(row.put?.ask)}</td>
                  <td>{formatPrice(row.put?.mid)}</td>
                  <td>{formatPercent(row.put?.custom_iv)}</td>
                  <td>{formatOpenInterest(row.put)}</td>
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

function formatOpenInterest(_row: (typeof seedSnapshot.rows)[number] | null | undefined): string {
  return "—";
}
