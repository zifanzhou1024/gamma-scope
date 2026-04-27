import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReplayImportPanel, validateReplayImportFiles } from "../components/ReplayImportPanel";
import type { ReplayImportResult } from "../lib/replayImportSource";

function importResult(overrides: Partial<ReplayImportResult> = {}): ReplayImportResult {
  return {
    import_id: "import-ui-test",
    status: "awaiting_confirmation",
    summary: {
      symbol: "SPX",
      scope: "0DTE",
      trade_date: "2026-04-24",
      expiry: "2026-04-24",
      start_time: "2026-04-24T14:30:00Z",
      end_time: "2026-04-24T14:32:00Z",
      snapshot_count: 3,
      quote_count: 12,
      valid_quote_count: 11,
      invalid_quote_count: 1,
      quote_rows_per_snapshot: 4,
      snapshots_sha256: "snapshots-checksum-abc123",
      quotes_sha256: "quotes-checksum-def456",
      snapshot_previews: [
        {
          source_snapshot_id: "snap-1",
          source_order: 0,
          snapshot_time: "2026-04-24T14:30:00Z",
          row_count: 999
        },
        {
          source_snapshot_id: "snap-2",
          source_order: 1,
          snapshot_time: "2026-04-24T14:31:00Z",
          row_count: 999
        },
        {
          source_snapshot_id: "snap-3",
          source_order: 2,
          snapshot_time: "2026-04-24T14:32:00Z",
          row_count: 999
        }
      ]
    },
    warnings: ["duplicate market_time values in snapshots.parquet: 2026-04-24T14:31:00Z"],
    errors: ["1 invalid quote rows found"],
    session_id: null,
    replay_url: null,
    ...overrides
  };
}

function renderPanel(result: ReplayImportResult | null = null, isAdminAuthenticated = true): string {
  return renderToStaticMarkup(
    <ReplayImportPanel
      isAdminAuthenticated={isAdminAuthenticated}
      csrfToken={isAdminAuthenticated ? "csrf-token" : null}
      currentImport={result}
      isUploading={false}
      isConfirming={false}
      errorMessage={null}
      onUpload={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe("ReplayImportPanel", () => {
  it("hides import controls for public users", () => {
    expect(renderPanel(null, false)).toBe("");
  });

  it("renders upload controls for authenticated admins", () => {
    const markup = renderPanel();

    expect(markup).toContain("Replay import");
    expect(markup).toContain("snapshots.parquet");
    expect(markup).toContain("quotes.parquet");
    expect(markup).toContain("Upload import");
  });

  it("requires both parquet files before upload", () => {
    const snapshots = new File(["snapshot bytes"], "snapshots.parquet", { type: "application/octet-stream" });
    const quotes = new File(["quote bytes"], "quotes.parquet", { type: "application/octet-stream" });

    expect(validateReplayImportFiles(null, null)).toBe("Choose snapshots.parquet and quotes.parquet before uploading.");
    expect(validateReplayImportFiles(snapshots, null)).toBe("Choose quotes.parquet before uploading.");
    expect(validateReplayImportFiles(null, quotes)).toBe("Choose snapshots.parquet before uploading.");
    expect(validateReplayImportFiles(snapshots, quotes)).toBeNull();
  });

  it("renders review metadata, checksums, messages, and first middle last previews", () => {
    const markup = renderPanel(importResult());

    expect(markup).toContain("2026-04-24");
    expect(markup).toContain("2026-04-24T14:30:00Z");
    expect(markup).toContain("2026-04-24T14:32:00Z");
    expect(markup).toContain("3");
    expect(markup).toContain("12");
    expect(markup).toContain("11");
    expect(markup).toContain("1");
    expect(markup).toContain("snapshots-checksum-abc123");
    expect(markup).toContain("quotes-checksum-def456");
    expect(markup).toContain("duplicate market_time values");
    expect(markup).toContain("1 invalid quote rows found");
    expect(markup).toContain("First");
    expect(markup).toContain("Middle");
    expect(markup).toContain("Last");
    expect(markup).toContain("snap-1");
    expect(markup).toContain("snap-2");
    expect(markup).toContain("snap-3");
  });

  it("only renders confirm and cancel actions for imports awaiting confirmation", () => {
    const awaitingMarkup = renderPanel(importResult());
    const completedMarkup = renderPanel(importResult({
      status: "completed",
      session_id: "import-session-ready",
      replay_url: "/replay?session_id=import-session-ready"
    }));

    expect(awaitingMarkup).toContain("Confirm import");
    expect(awaitingMarkup).toContain("Cancel import");
    expect(completedMarkup).not.toContain("Confirm import");
    expect(completedMarkup).not.toContain("Cancel import");
  });
});
