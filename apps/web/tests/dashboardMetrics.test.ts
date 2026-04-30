import { describe, expect, it } from "vitest";
import {
  deriveMarketMap,
  deriveMarketIntelligence,
  deriveLevelHistoryEntry,
  deriveLevelMovements,
  deriveDataQuality,
  filterChainRowsBySide,
  formatBasisPointDiff,
  formatGammaDiff,
  formatIvDiffBasisPoints,
  formatNumber,
  formatPercent,
  formatInteger,
  formatSnapshotTime,
  formatStatusLabel,
  deriveOperationalNotices,
  filterRowsToSpotCenteredStrikeWindow,
  getRowOperationalStatusDisplays,
  getRowOperationalStatusDisplay,
  getAtmMetricValue,
  getTransportStatusDisplay,
  getComparisonStatusDisplay,
  groupRowsByStrike,
  nearestStrike,
  summarizeSnapshot,
  updateLevelHistory
} from "../lib/dashboardMetrics";
import { buildPath, buildSeries } from "../lib/chartGeometry";
import { seedSnapshot } from "../lib/seedSnapshot";

describe("dashboard metrics", () => {
  const marketMapSnapshot = {
    ...seedSnapshot,
    spot: 5206,
    forward: 5207.5,
    rows: [
      { ...seedSnapshot.rows[0]!, strike: 5190, right: "call" as const, custom_iv: 0.22, custom_gamma: -0.01, custom_vanna: -0.04 },
      { ...seedSnapshot.rows[1]!, strike: 5190, right: "put" as const, custom_iv: 0.24, custom_gamma: -0.02, custom_vanna: -0.03 },
      { ...seedSnapshot.rows[2]!, strike: 5200, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.03, custom_vanna: -0.01 },
      { ...seedSnapshot.rows[3]!, strike: 5200, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.02, custom_vanna: 0.005 },
      { ...seedSnapshot.rows[4]!, strike: 5210, right: "call" as const, custom_iv: 0.21, custom_gamma: 0.04, custom_vanna: 0.03 },
      { ...seedSnapshot.rows[5]!, strike: 5210, right: "put" as const, custom_iv: 0.17, custom_gamma: 0.01, custom_vanna: 0.02 }
    ]
  };

  it("summarizes the seeded analytics snapshot", () => {
    const summary = summarizeSnapshot(seedSnapshot);

    expect(summary.rowCount).toBe(34);
    expect(summary.strikeRange).toEqual([5120, 5280]);
    expect(summary.averageIv).toBeCloseTo(0.1907);
    expect(summary.totalAbsGamma).toBeCloseTo(0.20565);
    expect(summary.totalAbsVanna).toBeCloseTo(0.181896);
  });

  it("summarizes net and absolute exposures", () => {
    const summary = summarizeSnapshot(marketMapSnapshot);

    expect(summary.totalNetGamma).toBeCloseTo(0.07);
    expect(summary.totalAbsGamma).toBeCloseTo(0.13);
    expect(summary.totalNetVanna).toBeCloseTo(-0.025);
    expect(summary.totalAbsVanna).toBeCloseTo(0.135);
  });

  it("derives spot-relative market map levels", () => {
    const marketMap = deriveMarketMap(marketMapSnapshot);

    expect(marketMap.spot).toBe(5206);
    expect(marketMap.forward).toBe(5207.5);
    expect(marketMap.atmStrike).toBe(5210);
    expect(marketMap.callIvLow).toMatchObject({ strike: 5200, value: 0.18 });
    expect(marketMap.putIvLow).toMatchObject({ strike: 5210, value: 0.17 });
    expect(marketMap.gammaPeak).toMatchObject({ strike: 5210, value: 0.05 });
    expect(marketMap.vannaFlip?.strike).toBeCloseTo(5200.91, 2);
    expect(marketMap.vannaMax).toMatchObject({ strike: 5210, value: 0.05 });
  });

  it("filters rows to a spot-centered strike window while keeping calls and puts", () => {
    const rows = [80, 90, 100, 110, 120, 130, 140].flatMap((strike) => [
      { ...seedSnapshot.rows[0]!, strike, right: "call" as const },
      { ...seedSnapshot.rows[1]!, strike, right: "put" as const }
    ]);

    const filteredRows = filterRowsToSpotCenteredStrikeWindow(rows, 106, 2);

    expect(Array.from(new Set(filteredRows.map((row) => row.strike)))).toEqual([90, 100, 110, 120, 130]);
    expect(filteredRows).toHaveLength(10);
    expect(filteredRows.filter((row) => row.right === "call")).toHaveLength(5);
    expect(filteredRows.filter((row) => row.right === "put")).toHaveLength(5);
  });

  it("appends bounded level history and resets when session or expiry changes", () => {
    const firstEntry = deriveLevelHistoryEntry(marketMapSnapshot, "replay");
    const secondEntry = deriveLevelHistoryEntry(
      { ...marketMapSnapshot, spot: 5208, snapshot_time: "2026-04-23T18:00:01Z" },
      "replay"
    );
    const thirdEntry = deriveLevelHistoryEntry(
      { ...marketMapSnapshot, spot: 5209, snapshot_time: "2026-04-23T18:00:02Z" },
      "replay"
    );

    const boundedHistory = updateLevelHistory(
      updateLevelHistory(updateLevelHistory([], firstEntry, 2), secondEntry, 2),
      thirdEntry,
      2
    );

    expect(boundedHistory).toHaveLength(2);
    expect(boundedHistory.map((entry) => entry.levels.spot)).toEqual([5208, 5209]);

    const changedSession = deriveLevelHistoryEntry({ ...marketMapSnapshot, session_id: "new-session" }, "replay");
    expect(updateLevelHistory(boundedHistory, changedSession, 2)).toEqual([changedSession]);

    const changedExpiry = deriveLevelHistoryEntry({ ...marketMapSnapshot, expiry: "2026-04-24" }, "replay");
    expect(updateLevelHistory(boundedHistory, changedExpiry, 2)).toEqual([changedExpiry]);
  });

  it("derives previous current delta and direction for tracked market levels", () => {
    const previous = deriveLevelHistoryEntry(marketMapSnapshot, "realtime");
    const current = deriveLevelHistoryEntry(
      {
        ...marketMapSnapshot,
        spot: 5207,
        rows: [
          { ...seedSnapshot.rows[0]!, strike: 5190, right: "call" as const, custom_iv: 0.16, custom_gamma: 0.01, custom_vanna: -0.04 },
          { ...seedSnapshot.rows[1]!, strike: 5190, right: "put" as const, custom_iv: 0.24, custom_gamma: 0.01, custom_vanna: -0.03 },
          { ...seedSnapshot.rows[2]!, strike: 5200, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.02, custom_vanna: -0.01 },
          { ...seedSnapshot.rows[3]!, strike: 5200, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.01, custom_vanna: 0.005 },
          { ...seedSnapshot.rows[4]!, strike: 5210, right: "call" as const, custom_iv: 0.21, custom_gamma: 0.01, custom_vanna: 0.03 },
          { ...seedSnapshot.rows[5]!, strike: 5210, right: "put" as const, custom_iv: 0.17, custom_gamma: 0.01, custom_vanna: 0.02 }
        ]
      },
      "realtime"
    );

    const movements = deriveLevelMovements([previous, current]);

    expect(movements.spot).toMatchObject({ previous: 5206, current: 5207, delta: 1, direction: "Up" });
    expect(movements.callIvLowStrike).toMatchObject({ previous: 5200, current: 5190, delta: -10, direction: "Down" });
    expect(movements.putIvLowStrike).toMatchObject({ previous: 5210, current: 5210, delta: 0, direction: "Flat" });
    expect(movements.gammaPeakStrike).toMatchObject({ previous: 5210, current: 5200, delta: -10, direction: "Down" });
    expect(movements.vannaFlipStrike.direction).toBe("Flat");
  });

  it("marks movements unavailable until at least two compatible snapshots exist", () => {
    const movements = deriveLevelMovements([deriveLevelHistoryEntry(marketMapSnapshot, "realtime")]);

    expect(movements.spot).toMatchObject({ previous: null, current: 5206, delta: null, direction: "Unavailable" });
  });

  it("derives expected move bands from ATM IV and remaining time to SPX close", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "2026-04-23",
      snapshot_time: "2026-04-23T18:00:00Z",
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 4990, right: "call" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[1]!, strike: 4990, right: "put" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[2]!, strike: 5000, right: "call" as const, custom_iv: 0.16 },
        { ...seedSnapshot.rows[3]!, strike: 5000, right: "put" as const, custom_iv: 0.16 },
        { ...seedSnapshot.rows[4]!, strike: 5010, right: "call" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[5]!, strike: 5010, right: "put" as const, custom_iv: 0.32 }
      ]
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.expectedMove.iv).toBeCloseTo(0.16);
    expect(intelligence.expectedMove.oneSigma.move).toBeCloseTo(12.09, 2);
    expect(intelligence.expectedMove.oneSigma.range).toEqual([
      expect.closeTo(4987.91, 2),
      expect.closeTo(5012.09, 2)
    ]);
    expect(intelligence.expectedMove.halfSigma.range).toEqual([
      expect.closeTo(4993.96, 2),
      expect.closeTo(5006.04, 2)
    ]);
  });

  it("falls back to average IV for expected move and clamps expired time to zero", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "2026-04-23",
      snapshot_time: "2026-04-23T21:00:00Z",
      rows: marketMapSnapshot.rows.map((row) => ({
        ...row,
        custom_iv: row.strike === 5000 ? null : 0.24
      }))
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.expectedMove.iv).toBeCloseTo(0.24);
    expect(intelligence.expectedMove.oneSigma.move).toBe(0);
    expect(intelligence.expectedMove.oneSigma.range).toEqual([5000, 5000]);
    expect(intelligence.expectedMove.halfSigma.range).toEqual([5000, 5000]);
  });

  it("uses the 21:00Z SPX close during standard time", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "2026-01-15",
      snapshot_time: "2026-01-15T20:00:00Z",
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 4990, right: "call" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[1]!, strike: 4990, right: "put" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[2]!, strike: 5000, right: "call" as const, custom_iv: 0.16 },
        { ...seedSnapshot.rows[3]!, strike: 5000, right: "put" as const, custom_iv: 0.16 },
        { ...seedSnapshot.rows[4]!, strike: 5010, right: "call" as const, custom_iv: 0.32 },
        { ...seedSnapshot.rows[5]!, strike: 5010, right: "put" as const, custom_iv: 0.32 }
      ]
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.expectedMove.timeToCloseYears).toBeCloseTo(1 / (365 * 24));
    expect(intelligence.expectedMove.oneSigma.move).toBeCloseTo(8.55, 2);
    expect(intelligence.expectedMove.oneSigma.range).toEqual([
      expect.closeTo(4991.45, 2),
      expect.closeTo(5008.55, 2)
    ]);
  });

  it("returns zero-time expected moves for malformed snapshot dates", () => {
    const badSnapshotTime = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "2026-04-23",
      snapshot_time: "not-a-date"
    };
    const badExpiry = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "not-an-expiry",
      snapshot_time: "2026-04-23T18:00:00Z"
    };
    const badCalendarExpiry = {
      ...marketMapSnapshot,
      spot: 5000,
      expiry: "2026-02-31",
      snapshot_time: "2026-02-27T18:00:00Z"
    };

    expect(() => deriveMarketIntelligence(badSnapshotTime)).not.toThrow();
    expect(() => deriveMarketIntelligence(badExpiry)).not.toThrow();
    expect(() => deriveMarketIntelligence(badCalendarExpiry)).not.toThrow();

    for (const snapshot of [badSnapshotTime, badExpiry, badCalendarExpiry]) {
      const intelligence = deriveMarketIntelligence(snapshot);

      expect(intelligence.expectedMove.timeToCloseYears).toBe(0);
      expect(intelligence.expectedMove.oneSigma.move).toBe(0);
      expect(intelligence.expectedMove.oneSigma.range).toEqual([5000, 5000]);
      expect(Number.isFinite(intelligence.expectedMove.oneSigma.move)).toBe(true);
    }
  });

  it("derives wall levels and deterministic regime labels", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5200,
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 5180, right: "call" as const, custom_iv: 0.24, custom_gamma: 0.01, custom_vanna: 0.01, open_interest: 100 },
        { ...seedSnapshot.rows[1]!, strike: 5180, right: "put" as const, custom_iv: 0.23, custom_gamma: 0.02, custom_vanna: 0.02, open_interest: 300 },
        { ...seedSnapshot.rows[2]!, strike: 5200, right: "call" as const, custom_iv: 0.2, custom_gamma: 0.01, custom_vanna: -0.3, open_interest: 100 },
        { ...seedSnapshot.rows[3]!, strike: 5200, right: "put" as const, custom_iv: 0.2, custom_gamma: 0.01, custom_vanna: -0.2, open_interest: 100 },
        { ...seedSnapshot.rows[4]!, strike: 5220, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.015, custom_vanna: 0.05, open_interest: 100 },
        { ...seedSnapshot.rows[5]!, strike: 5220, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.005, custom_vanna: 0.04, open_interest: 100 }
      ]
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.walls.positiveGamma).toMatchObject({ strike: 5220, value: expect.closeTo(27040000) });
    expect(intelligence.walls.negativeGamma).toMatchObject({ strike: 5180, value: expect.closeTo(-135200000) });
    expect(intelligence.walls.vanna).toMatchObject({ strike: 5200, value: -0.5 });
    expect(intelligence.regimes).toEqual({
      gamma: "Pinning",
      vanna: "Suppressive",
      ivSmileBias: "Left-skew"
    });
  });

  it("derives negative signed GEX walls from put open interest when raw gammas are non-negative", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5200,
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 5180, right: "call" as const, custom_iv: 0.24, custom_gamma: 0.01, custom_vanna: 0.01, open_interest: 100 },
        { ...seedSnapshot.rows[1]!, strike: 5180, right: "put" as const, custom_iv: 0.23, custom_gamma: 0.02, custom_vanna: 0.02, open_interest: 300 },
        { ...seedSnapshot.rows[2]!, strike: 5220, right: "call" as const, custom_iv: 0.18, custom_gamma: 0.015, custom_vanna: 0.05, open_interest: 100 },
        { ...seedSnapshot.rows[3]!, strike: 5220, right: "put" as const, custom_iv: 0.19, custom_gamma: 0.005, custom_vanna: 0.04, open_interest: 100 }
      ]
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.walls.positiveGamma).toMatchObject({ strike: 5220, value: expect.closeTo(27040000) });
    expect(intelligence.walls.negativeGamma).toMatchObject({ strike: 5180, value: expect.closeTo(-135200000) });
    expect(intelligence.regimes.gamma).toBe("Pinning");
  });

  it("does not create signed GEX walls from rows missing gamma or open interest", () => {
    const snapshot = {
      ...marketMapSnapshot,
      spot: 5200,
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 5180, right: "call" as const, custom_gamma: null, custom_vanna: 0.01, open_interest: 100 },
        { ...seedSnapshot.rows[1]!, strike: 5180, right: "put" as const, custom_gamma: 0.02, custom_vanna: 0.02, open_interest: null },
        { ...seedSnapshot.rows[2]!, strike: 5220, right: "call" as const, custom_gamma: null, custom_vanna: 0.05, open_interest: null }
      ]
    };

    const intelligence = deriveMarketIntelligence(snapshot);

    expect(intelligence.walls.positiveGamma).toBeNull();
    expect(intelligence.walls.negativeGamma).toBeNull();
    expect(intelligence.walls.vanna).toMatchObject({ strike: 5220, value: 0.05 });
  });

  it("returns ATM aggregate values for chart headers", () => {
    expect(getAtmMetricValue(marketMapSnapshot, "custom_iv")).toBeCloseTo(0.19);
    expect(getAtmMetricValue(marketMapSnapshot, "custom_gamma")).toBeCloseTo(0.05);
    expect(getAtmMetricValue(marketMapSnapshot, "custom_vanna")).toBeCloseTo(0.05);
  });

  it("returns null for missing ATM exposure values", () => {
    const snapshotWithMissingAtmExposures = {
      ...marketMapSnapshot,
      rows: marketMapSnapshot.rows.map((row) =>
        row.strike === 5210 ? { ...row, custom_gamma: null, custom_vanna: null } : row
      )
    };

    expect(getAtmMetricValue(snapshotWithMissingAtmExposures, "custom_gamma")).toBeNull();
    expect(getAtmMetricValue(snapshotWithMissingAtmExposures, "custom_vanna")).toBeNull();
  });

  it("formats dashboard values consistently", () => {
    expect(formatPercent(0.184)).toBe("18.40%");
    expect(formatPercent(null)).toBe("—");
    expect(formatNumber(0.012345, 4)).toBe("0.0123");
    expect(formatNumber(null, 4)).toBe("—");
    expect(formatBasisPointDiff(-0.002)).toBe("-20.0 bp");
    expect(formatBasisPointDiff(null)).toBe("—");
    expect(formatInteger(2614)).toBe("2,614");
    expect(formatInteger(null)).toBe("—");
    expect(formatStatusLabel("partial")).toBe("Partial");
  });

  it("formats IBKR comparison deltas compactly", () => {
    expect(formatIvDiffBasisPoints(-0.0015)).toBe("-15.0 bp");
    expect(formatIvDiffBasisPoints(0.001)).toBe("+10.0 bp");
    expect(formatIvDiffBasisPoints(null)).toBe("—");
    expect(formatIvDiffBasisPoints(undefined)).toBe("—");

    expect(formatGammaDiff(0.000302)).toBe("+0.00030");
    expect(formatGammaDiff(-0.000242)).toBe("-0.00024");
    expect(formatGammaDiff(-0)).toBe("0.00000");
    expect(formatGammaDiff(null)).toBe("—");
    expect(formatGammaDiff(undefined)).toBe("—");
  });

  it("maps IBKR comparison statuses to compact labels and tones", () => {
    expect(getComparisonStatusDisplay("ok")).toEqual({ label: "OK", tone: "ok" });
    expect(getComparisonStatusDisplay("outside_tolerance")).toEqual({
      label: "Outside tolerance",
      tone: "warning"
    });
    expect(getComparisonStatusDisplay("missing")).toEqual({ label: "Missing", tone: "muted" });
    expect(getComparisonStatusDisplay(null)).toEqual({ label: "No IBKR", tone: "muted" });
    expect(getComparisonStatusDisplay(undefined)).toEqual({ label: "No IBKR", tone: "muted" });
  });

  it("maps live transport statuses to compact labels and tones", () => {
    expect(getTransportStatusDisplay("connecting")).toEqual({ label: "Connecting", tone: "muted" });
    expect(getTransportStatusDisplay("streaming")).toEqual({ label: "Streaming", tone: "ok" });
    expect(getTransportStatusDisplay("disconnected")).toEqual({ label: "Disconnected", tone: "error" });
    expect(getTransportStatusDisplay("fallback_polling")).toEqual({ label: "Fallback polling", tone: "warning" });
    expect(getTransportStatusDisplay("reconnecting")).toEqual({ label: "Reconnecting", tone: "muted" });
  });

  it("derives Moomoo collector detail from the compatibility collector id", () => {
    expect(deriveDataQuality(seedSnapshot, {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-moomoo",
      status: "connected",
      ibkr_account_mode: "unknown",
      message: "Moomoo compatibility snapshot emitted",
      event_time: "2026-04-30T15:00:00Z",
      received_time: "2026-04-30T15:00:01Z"
    }, null, "realtime").collector).toMatchObject({
      label: "Collector Connected",
      detail: "Moomoo Source",
      tone: "ok"
    });
  });

  it("derives an explicit disconnected transport notice", () => {
    expect(deriveOperationalNotices({ ...seedSnapshot, coverage_status: "full" }, null, "disconnected")).toEqual([
      {
        key: "transport-disconnected",
        label: "Disconnected",
        message: "WebSocket stream disconnected.",
        tone: "error"
      }
    ]);
  });

  it("derives deterministic operational notices for degraded live data", () => {
    const degradedSnapshot = {
      ...seedSnapshot,
      source_status: "stale",
      coverage_status: "partial",
      rows: seedSnapshot.rows.map((row, index) => {
        if (index === 0) {
          return { ...row, bid: 12.1, ask: 11.9, calc_status: "missing_quote" as const };
        }
        if (index === 1) {
          return { ...row, calc_status: "solver_failed" as const };
        }
        return row;
      })
    } satisfies typeof seedSnapshot;
    const collectorHealth = {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-dev",
      status: "degraded",
      ibkr_account_mode: "paper",
      message: "Market data delayed",
      event_time: "2026-04-24T15:00:00Z",
      received_time: "2026-04-24T15:00:01Z"
    } as const;

    expect(deriveOperationalNotices(degradedSnapshot, collectorHealth, "fallback_polling")).toEqual([
      {
        key: "transport-fallback_polling",
        label: "Fallback polling",
        message: "WebSocket unavailable; polling is keeping the dashboard updated.",
        tone: "warning"
      },
      {
        key: "coverage-partial",
        label: "Partial chain",
        message: "Option chain coverage is partial.",
        tone: "warning"
      },
      {
        key: "source-stale",
        label: "Source stale",
        message: "Snapshot source is stale.",
        tone: "warning"
      },
      {
        key: "collector-degraded",
        label: "Collector degraded",
        message: "Market data delayed",
        tone: "warning"
      },
      {
        key: "quotes-crossed",
        label: "Crossed quotes",
        message: "1 option has bid above ask.",
        tone: "warning"
      },
      {
        key: "calc-issues",
        label: "Calculation issues",
        message: "Missing quote: 1; Solver failed: 1.",
        tone: "error"
      }
    ]);
  });

  it("derives compact data quality details for degraded realtime snapshots", () => {
    const degradedSnapshot = {
      ...seedSnapshot,
      mode: "live",
      snapshot_time: "2026-04-23T20:30:00Z",
      expiry: "2026-04-23",
      source_status: "stale",
      coverage_status: "partial",
      freshness_ms: 18_500,
      rows: [
        { ...seedSnapshot.rows[0]!, strike: 5200, bid: 12, ask: 12.5, calc_status: "ok" as const },
        { ...seedSnapshot.rows[1]!, strike: 5200, bid: 13, ask: 12.5, calc_status: "solver_failed" as const },
        { ...seedSnapshot.rows[2]!, strike: 5210, bid: null, ask: 3.25, calc_status: "missing_quote" as const },
        { ...seedSnapshot.rows[3]!, strike: 5220, bid: 2.25, ask: null, calc_status: "ok" as const }
      ]
    } satisfies typeof seedSnapshot;
    const collectorHealth = {
      schema_version: "1.0.0",
      source: "ibkr",
      collector_id: "local-dev",
      status: "degraded",
      ibkr_account_mode: "paper",
      message: "Market data delayed",
      event_time: "2026-04-23T20:30:00Z",
      received_time: "2026-04-23T20:30:01Z"
    } as const;

    expect(deriveDataQuality(degradedSnapshot, collectorHealth, "fallback_polling", "realtime")).toEqual({
      lastUpdated: "04:30:00 PM EDT",
      expiry: "2026-04-23",
      isZeroDte: true,
      zeroDteLabel: "0DTE",
      rowCount: 4,
      distinctStrikeCount: 3,
      freshness: {
        label: "18.5s stale",
        tone: "warning"
      },
      source: {
        label: "Source stale",
        tone: "warning"
      },
      coverage: {
        label: "Partial chain",
        tone: "warning"
      },
      transport: {
        label: "Transport Fallback polling",
        tone: "warning"
      },
      collector: {
        label: "Collector Degraded",
        detail: "IBKR Paper",
        tone: "warning"
      },
      qualitySummary: {
        validQuoteRows: 1,
        crossedQuoteRows: 1,
        missingBidAskRows: 2,
        nonOkCalcRows: 2
      },
      mode: {
        label: "Live mode",
        detail: "Realtime dashboard",
        tone: "ok"
      }
    });
  });

  it("compares 0DTE status against the New York market date", () => {
    const snapshotNearUtcMidnight = {
      ...seedSnapshot,
      snapshot_time: "2026-04-24T01:30:00Z",
      expiry: "2026-04-23"
    } satisfies typeof seedSnapshot;
    const nextExpirySnapshot = {
      ...snapshotNearUtcMidnight,
      expiry: "2026-04-24"
    } satisfies typeof seedSnapshot;

    expect(deriveDataQuality(snapshotNearUtcMidnight).zeroDteLabel).toBe("0DTE");
    expect(deriveDataQuality(nextExpirySnapshot).zeroDteLabel).toBe("Not 0DTE");
  });

  it("treats replay snapshots on the replay dashboard as a matched mode", () => {
    const replayQuality = deriveDataQuality({ ...seedSnapshot, mode: "replay" }, null, null, "replay");

    expect(replayQuality.mode).toEqual({
      label: "Replay mode",
      detail: "Replay dashboard",
      tone: "ok"
    });
  });

  it("maps row operational statuses including crossed quotes", () => {
    expect(getRowOperationalStatusDisplay(seedSnapshot.rows[0]!)).toEqual(null);
    expect(getRowOperationalStatusDisplay({ ...seedSnapshot.rows[0]!, bid: 12.1, ask: 11.9 })).toEqual({
      label: "Crossed quote",
      tone: "warning"
    });
    expect(getRowOperationalStatusDisplay({ ...seedSnapshot.rows[0]!, calc_status: "out_of_model_scope" })).toEqual({
      label: "Out of model scope",
      tone: "muted"
    });
    expect(getRowOperationalStatusDisplay({ ...seedSnapshot.rows[0]!, calc_status: "solver_failed" })).toEqual({
      label: "Solver failed",
      tone: "error"
    });
  });

  it("keeps crossed quote and calculation issue visible for the same row", () => {
    expect(
      getRowOperationalStatusDisplays({
        ...seedSnapshot.rows[0]!,
        bid: 12.1,
        ask: 11.9,
        calc_status: "stale_underlying"
      })
    ).toEqual([
      { label: "Crossed quote", tone: "warning" },
      { label: "Stale underlying", tone: "warning" }
    ]);
  });

  it("formats snapshot time in the SPX market timezone", () => {
    expect(formatSnapshotTime("2026-04-23T16:00:00Z")).toBe("12:00:00 PM EDT");
  });

  it("groups call and put contracts into strike-centered chain rows", () => {
    const groupedRows = groupRowsByStrike(seedSnapshot.rows);

    expect(groupedRows).toHaveLength(17);
    expect(groupedRows[0]?.strike).toBe(5120);
    expect(groupedRows[8]?.strike).toBe(5200);
    expect(groupedRows[8]?.call?.right).toBe("call");
    expect(groupedRows[8]?.put?.right).toBe("put");
  });

  it("keeps all chain rows unchanged for the all-side filter", () => {
    const groupedRows = groupRowsByStrike(seedSnapshot.rows);

    expect(filterChainRowsBySide(groupedRows, "all")).toEqual(groupedRows);
  });

  it("keeps every strike and hides put data for the calls-side filter", () => {
    const groupedRows = groupRowsByStrike(seedSnapshot.rows);
    const filteredRows = filterChainRowsBySide(groupedRows, "calls");

    expect(filteredRows).toHaveLength(groupedRows.length);
    expect(filteredRows.map((row) => row.strike)).toEqual(groupedRows.map((row) => row.strike));
    expect(filteredRows.every((row) => row.call?.right === "call")).toBe(true);
    expect(filteredRows.every((row) => row.put === null)).toBe(true);
  });

  it("keeps every strike and hides call data for the puts-side filter", () => {
    const groupedRows = groupRowsByStrike(seedSnapshot.rows);
    const filteredRows = filterChainRowsBySide(groupedRows, "puts");

    expect(filteredRows).toHaveLength(groupedRows.length);
    expect(filteredRows.map((row) => row.strike)).toEqual(groupedRows.map((row) => row.strike));
    expect(filteredRows.every((row) => row.call === null)).toBe(true);
    expect(filteredRows.every((row) => row.put?.right === "put")).toBe(true);
  });

  it("identifies the strike nearest to spot", () => {
    expect(nearestStrike(seedSnapshot)).toBe(5200);
  });
});

describe("chart geometry", () => {
  it("builds strike-sorted series and filters null values", () => {
    const rows = [
      { strike: 5210, custom_iv: 0.2 },
      { strike: 5200, custom_iv: 0.18 },
      { strike: 5220, custom_iv: null }
    ];

    expect(buildSeries(rows, "custom_iv")).toEqual([
      { x: 5200, y: 0.18 },
      { x: 5210, y: 0.2 }
    ]);
  });

  it("builds an SVG path for a multi-point series", () => {
    const path = buildPath(
      [
        { x: 5200, y: 0.18 },
        { x: 5210, y: 0.2 }
      ],
      { width: 320, height: 160, padding: 20 }
    );

    expect(path).toMatch(/^M /);
    expect(path).toContain(" L ");
  });

  it("builds an SVG path against a shared multi-series domain", () => {
    const path = buildPath(
      [
        { x: 0, y: 10 },
        { x: 1, y: 20 }
      ],
      { width: 100, height: 100, padding: 10 },
      [
        { x: 0, y: 0 },
        { x: 1, y: 10 },
        { x: 1, y: 20 }
      ]
    );

    expect(path).toBe("M 10.00 50.00 L 90.00 10.00");
  });

  it("returns an empty path for fewer than two points", () => {
    expect(buildPath([{ x: 5200, y: 0.18 }], { width: 320, height: 160, padding: 20 })).toBe("");
  });
});
