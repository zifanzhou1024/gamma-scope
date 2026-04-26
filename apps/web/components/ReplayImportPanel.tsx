import React, { useState } from "react";
import type { ReplayImportResult } from "../lib/replayImportSource";

export interface ReplayImportPanelProps {
  isAdminAuthenticated: boolean;
  csrfToken: string | null;
  currentImport: ReplayImportResult | null;
  isUploading: boolean;
  isConfirming: boolean;
  errorMessage: string | null;
  onUpload(snapshots: File, quotes: File): void;
  onConfirm(importId: string): void;
  onCancel(importId: string): void;
}

interface PreviewRow {
  label: string;
  sourceSnapshotId: string;
  sourceOrder: string;
  snapshotTime: string;
  rowCount: string;
}

export function validateReplayImportFiles(
  snapshots: File | null | undefined,
  quotes: File | null | undefined
): string | null {
  if (!snapshots && !quotes) {
    return "Choose snapshots.parquet and quotes.parquet before uploading.";
  }

  if (!snapshots) {
    return "Choose snapshots.parquet before uploading.";
  }

  if (!quotes) {
    return "Choose quotes.parquet before uploading.";
  }

  return null;
}

export function ReplayImportPanel({
  isAdminAuthenticated,
  csrfToken,
  currentImport,
  isUploading,
  isConfirming,
  errorMessage,
  onUpload,
  onConfirm,
  onCancel
}: ReplayImportPanelProps) {
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  if (!isAdminAuthenticated) {
    return null;
  }

  const summary = currentImport?.summary ?? {};
  const summaryItems = currentImport ? importSummaryItems(summary) : [];
  const checksumItems = currentImport ? importChecksumItems(summary) : [];
  const previews = currentImport ? importPreviewRows(summary) : [];
  const isAwaitingConfirmation = currentImport?.status === "awaiting_confirmation";
  const uploadDisabled = isUploading || isConfirming || !csrfToken;

  return (
    <section className="replayImportPanel" aria-label="Replay import">
      <form
        className="replayImportForm"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const snapshots = fileFromInput(form.elements.namedItem("snapshots"));
          const quotes = fileFromInput(form.elements.namedItem("quotes"));
          const validation = validateReplayImportFiles(snapshots, quotes);

          setValidationMessage(validation);
          if (validation || !snapshots || !quotes) {
            return;
          }

          onUpload(snapshots, quotes);
        }}
      >
        <span className="eyebrow">Replay import</span>
        <div className="importFileGrid">
          <label>
            <span>snapshots.parquet</span>
            <input type="file" name="snapshots" accept=".parquet" disabled={uploadDisabled} />
          </label>
          <label>
            <span>quotes.parquet</span>
            <input type="file" name="quotes" accept=".parquet" disabled={uploadDisabled} />
          </label>
        </div>
        <button type="submit" disabled={uploadDisabled}>
          {isUploading ? "Uploading" : "Upload import"}
        </button>
        {!csrfToken ? (
          <p className="importMessage importMessage-error" role="status">Admin session token unavailable.</p>
        ) : null}
        {validationMessage ? (
          <p className="importMessage importMessage-error" role="alert">{validationMessage}</p>
        ) : null}
      </form>

      {errorMessage ? <p className="importMessage importMessage-error" role="alert">{errorMessage}</p> : null}

      {currentImport ? (
        <div className="importReview" aria-label="Import review">
          <div className="importReviewHeader">
            <div>
              <span className="eyebrow">Review</span>
              <strong>{currentImport.import_id}</strong>
            </div>
            <span className={`statusPill importStatus-${currentImport.status}`}>{currentImport.status}</span>
          </div>

          {summaryItems.length > 0 ? (
            <div className="importReviewGrid" aria-label="Import summary">
              {summaryItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {checksumItems.length > 0 ? (
            <div className="importChecksumList" aria-label="Import checksums">
              {checksumItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <code>{item.value}</code>
                </div>
              ))}
            </div>
          ) : null}

          {currentImport.warnings.length > 0 ? (
            <MessageList tone="warning" title="Warnings" messages={currentImport.warnings} />
          ) : null}
          {currentImport.errors.length > 0 ? (
            <MessageList tone="error" title="Errors" messages={currentImport.errors} />
          ) : null}

          {previews.length > 0 ? (
            <div className="importPreviewTable" aria-label="Snapshot previews">
              <table>
                <thead>
                  <tr>
                    <th>Preview</th>
                    <th>Snapshot ID</th>
                    <th>Order</th>
                    <th>Time</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map((preview) => (
                    <tr key={`${preview.label}-${preview.sourceSnapshotId}-${preview.sourceOrder}`}>
                      <td>{preview.label}</td>
                      <td>{preview.sourceSnapshotId}</td>
                      <td>{preview.sourceOrder}</td>
                      <td>{preview.snapshotTime}</td>
                      <td>{preview.rowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {isAwaitingConfirmation ? (
            <div className="importReviewActions">
              <button type="button" disabled={isConfirming} onClick={() => onConfirm(currentImport.import_id)}>
                {isConfirming ? "Confirming" : "Confirm import"}
              </button>
              <button
                type="button"
                className="secondaryButton"
                disabled={isConfirming || isUploading}
                onClick={() => onCancel(currentImport.import_id)}
              >
                Cancel import
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MessageList({
  tone,
  title,
  messages
}: {
  tone: "warning" | "error";
  title: string;
  messages: string[];
}) {
  return (
    <div className={`importMessage importMessage-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <ul>
        {messages.map((message, index) => (
          <li key={`${title}-${index}`}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function importSummaryItems(summary: Record<string, unknown>): Array<{ label: string; value: string }> {
  return [
    ["Symbol", "symbol"],
    ["Scope", "scope"],
    ["Trade date", "trade_date"],
    ["Expiry", "expiry"],
    ["Start", "start_time"],
    ["End", "end_time"],
    ["Snapshots", "snapshot_count"],
    ["Quotes", "quote_count"],
    ["Valid quotes", "valid_quote_count"],
    ["Invalid quotes", "invalid_quote_count"],
    ["Quotes / snapshot", "quote_rows_per_snapshot"],
    ["Source rows", "source_row_count_profile"]
  ].flatMap(([label, key]) => {
    const value = displayValue(summary[key]);
    return value ? [{ label, value }] : [];
  });
}

function importChecksumItems(summary: Record<string, unknown>): Array<{ label: string; value: string }> {
  return [
    ["Snapshots SHA-256", "snapshots_sha256"],
    ["Quotes SHA-256", "quotes_sha256"]
  ].flatMap(([label, key]) => {
    const value = displayValue(summary[key]);
    return value ? [{ label, value }] : [];
  });
}

function importPreviewRows(summary: Record<string, unknown>): PreviewRow[] {
  const previews = Array.isArray(summary.snapshot_previews)
    ? summary.snapshot_previews.filter(isRecord)
    : [];

  return previews.map((preview, index) => ({
    label: previewLabel(index, previews.length),
    sourceSnapshotId: displayValue(preview.source_snapshot_id) || "Unknown",
    sourceOrder: displayValue(preview.source_order) || "-",
    snapshotTime: displayValue(preview.snapshot_time) || "Unknown",
    rowCount: displayValue(preview.row_count) || "-"
  }));
}

function previewLabel(index: number, count: number): string {
  if (index === 0) {
    return "First";
  }

  if (index === count - 1) {
    return "Last";
  }

  return "Middle";
}

function fileFromInput(element: Element | RadioNodeList | null): File | null {
  if (element instanceof HTMLInputElement && element.files && element.files.length > 0) {
    return element.files.item(0);
  }

  return null;
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    const values = value.map(displayValue).filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values.join(", ") : null;
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
