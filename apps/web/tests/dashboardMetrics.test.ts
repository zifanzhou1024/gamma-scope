import { describe, expect, it } from "vitest";
import {
  filterChainRowsBySide,
  formatBasisPointDiff,
  formatNumber,
  formatPercent,
  formatInteger,
  formatSnapshotTime,
  formatStatusLabel,
  groupRowsByStrike,
  nearestStrike,
  summarizeSnapshot
} from "../lib/dashboardMetrics";
import { buildPath, buildSeries } from "../lib/chartGeometry";
import { seedSnapshot } from "../lib/seedSnapshot";

describe("dashboard metrics", () => {
  it("summarizes the seeded analytics snapshot", () => {
    const summary = summarizeSnapshot(seedSnapshot);

    expect(summary.rowCount).toBe(34);
    expect(summary.strikeRange).toEqual([5120, 5280]);
    expect(summary.averageIv).toBeCloseTo(0.1907);
    expect(summary.totalAbsGamma).toBeCloseTo(0.20565);
    expect(summary.totalAbsVanna).toBeCloseTo(0.181896);
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

  it("returns an empty path for fewer than two points", () => {
    expect(buildPath([{ x: 5200, y: 0.18 }], { width: 320, height: 160, padding: 20 })).toBe("");
  });
});
