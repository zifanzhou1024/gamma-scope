import { DashboardChart } from "../components/DashboardChart";
import {
  formatBasisPointDiff,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSnapshotTime,
  formatStatusLabel,
  formatStrikeRange,
  sortRowsByStrike,
  summarizeSnapshot
} from "../lib/dashboardMetrics";
import { seedSnapshot } from "../lib/seedSnapshot";

export default function Home() {
  const snapshot = seedSnapshot;
  const summary = summarizeSnapshot(snapshot);
  const rows = sortRowsByStrike(snapshot.rows);

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
        <div className="sectionHeader">
          <div>
            <h2>Option chain</h2>
            <p>Custom analytics are primary. IBKR fields are comparison-only.</p>
          </div>
          <strong>{summary.rowCount} rows</strong>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Side</th>
                <th>Strike</th>
                <th>Bid</th>
                <th>Ask</th>
                <th>Mid</th>
                <th>IV</th>
                <th>Gamma</th>
                <th>Vanna</th>
                <th>IV diff</th>
                <th>Gamma diff</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contract_id}>
                  <td>{row.contract_id}</td>
                  <td>{formatStatusLabel(row.right)}</td>
                  <td>{formatPrice(row.strike)}</td>
                  <td>{formatPrice(row.bid)}</td>
                  <td>{formatPrice(row.ask)}</td>
                  <td>{formatPrice(row.mid)}</td>
                  <td>{formatPercent(row.custom_iv)}</td>
                  <td>{formatNumber(row.custom_gamma, 4)}</td>
                  <td>{formatNumber(row.custom_vanna, 4)}</td>
                  <td>{formatBasisPointDiff(row.iv_diff)}</td>
                  <td>{formatNumber(row.gamma_diff, 4)}</td>
                  <td>
                    <span className={`statusPill status-${row.calc_status}`}>{formatStatusLabel(row.calc_status)}</span>
                  </td>
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
