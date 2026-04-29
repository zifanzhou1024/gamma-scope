import React from "react";
import { ExperimentalPanel } from "./ExperimentalPanel";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatNumber, formatPercent, formatPrice, formatStatusLabel } from "../../lib/dashboardMetrics";

interface ExperimentalTablesProps {
  analytics: ExperimentalAnalytics;
}

type TableColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => string;
};

type GenericExperimentalRow = ExperimentalAnalytics["moveNeeded"]["rows"][number];

export function ExperimentalTables({ analytics }: ExperimentalTablesProps) {
  return (
    <section className="experimentalTablesGrid" aria-label="Experimental tables">
      <ExperimentalPanel
        title={analytics.probabilities.label}
        status={analytics.probabilities.status}
        diagnostics={analytics.probabilities.diagnostics}
      >
        <ExperimentalTable
          caption="Risk-neutral probabilities"
          emptyMessage="No probability levels available."
          rows={analytics.probabilities.levels}
          columns={[
            { key: "strike", label: "Strike", render: (row) => formatPrice(row.strike) },
            { key: "closeAbove", label: "Close above", render: (row) => formatPercent(row.closeAbove, 1) },
            { key: "closeBelow", label: "Close below", render: (row) => formatPercent(row.closeBelow, 1) }
          ]}
        />
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.moveNeeded.label}
        status={analytics.moveNeeded.status}
        diagnostics={analytics.moveNeeded.diagnostics}
      >
        <ExperimentalTable
          caption="Move-needed map"
          emptyMessage="No move-needed rows available."
          rows={analytics.moveNeeded.rows}
          columns={[
            textColumn("strike", "Strike", (value) => formatPrice(numberValue(value))),
            textColumn("side", "Side", formatCellValue),
            textColumn("breakeven", "Breakeven", (value) => formatPrice(numberValue(value))),
            textColumn("moveNeeded", "Move needed", (value) => formatPrice(numberValue(value))),
            textColumn("expectedMoveRatio", "Exp move ratio", (value) => formatPercent(numberValue(value), 1)),
            textColumn("label", "Label", formatCellValue)
          ]}
        />
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.decayPressure.label}
        status={analytics.decayPressure.status}
        diagnostics={analytics.decayPressure.diagnostics}
      >
        <ExperimentalTable
          caption="Time-decay pressure"
          emptyMessage="No decay pressure rows available."
          rows={analytics.decayPressure.rows}
          columns={[
            textColumn("strike", "Strike", (value) => formatPrice(numberValue(value))),
            textColumn("side", "Side", formatCellValue),
            textColumn("premium", "Premium", (value) => formatPrice(numberValue(value))),
            textColumn("pointsPerMinute", "Points/min", (value) => formatNumber(numberValue(value), 3))
          ]}
        />
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.richCheap.label}
        status={analytics.richCheap.status}
        diagnostics={analytics.richCheap.diagnostics}
      >
        <ExperimentalTable
          caption="Rich/cheap residuals"
          emptyMessage="No rich/cheap residual rows available."
          rows={analytics.richCheap.rows}
          columns={[
            textColumn("strike", "Strike", (value) => formatPrice(numberValue(value))),
            textColumn("side", "Side", formatCellValue),
            textColumn("actualMid", "Actual mid", (value) => formatPrice(numberValue(value))),
            textColumn("fittedFair", "Fitted fair", (value) => formatPrice(numberValue(value))),
            textColumn("residual", "Residual", (value) => formatSignedNumber(numberValue(value), 2)),
            textColumn("label", "Label", formatCellValue)
          ]}
        />
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.quoteQuality.label}
        status={analytics.quoteQuality.status}
        diagnostics={analytics.quoteQuality.diagnostics}
      >
        <ExperimentalTable
          caption="Quote quality flags"
          emptyMessage="No quote quality flags."
          rows={analytics.quoteQuality.flags}
          columns={[
            { key: "strike", label: "Strike", render: (row) => formatPrice(row.strike) },
            { key: "right", label: "Right", render: (row) => formatStatusLabel(row.right) },
            { key: "code", label: "Code", render: (row) => formatStatusLabel(row.code) },
            { key: "message", label: "Message", render: (row) => row.message }
          ]}
        />
      </ExperimentalPanel>

      <ExperimentalPanel
        title={analytics.historyPreview.label}
        status={analytics.historyPreview.status}
        diagnostics={analytics.historyPreview.diagnostics}
      >
        <ExperimentalTable
          caption="Range compression preview"
          emptyMessage="No history rows available."
          rows={analytics.historyPreview.rows}
          columns={historyColumns(analytics.historyPreview.rows)}
        />
      </ExperimentalPanel>
    </section>
  );
}

function ExperimentalTable<Row>({
  caption,
  rows,
  columns,
  emptyMessage
}: {
  caption: string;
  rows: Row[];
  columns: Array<TableColumn<Row>>;
  emptyMessage: string;
}) {
  return (
    <div className="experimentalTableWrap">
      <table className="experimentalTable" aria-label={caption}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="experimentalTableEmpty" colSpan={Math.max(columns.length, 1)}>
                {emptyMessage}
              </td>
            </tr>
          ) : rows.map((row, rowIndex) => (
            <tr key={rowKey(row, rowIndex)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function textColumn(
  key: string,
  label: string,
  formatter: (value: unknown) => string
): TableColumn<GenericExperimentalRow> {
  return {
    key,
    label,
    render: (row) => formatter(row[key])
  };
}

function historyColumns(rows: GenericExperimentalRow[]): Array<TableColumn<GenericExperimentalRow>> {
  const keys = rows[0] ? Object.keys(rows[0]) : ["strike", "label"];
  return keys.slice(0, 6).map((key) => textColumn(key, formatStatusLabel(key), formatCellValue));
}

function rowKey(row: unknown, index: number): string {
  if (typeof row === "object" && row !== null && "strike" in row) {
    return `${String((row as { strike: unknown }).strike)}:${index}`;
  }
  return String(index);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function formatCellValue(value: unknown): string {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString("en-US") : formatNumber(value, 3);
  }
  if (typeof value === "string") {
    return formatStatusLabel(value);
  }
  return String(value);
}

function formatSignedNumber(value: number | null, digits: number): string {
  if (value == null) {
    return "-";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}
