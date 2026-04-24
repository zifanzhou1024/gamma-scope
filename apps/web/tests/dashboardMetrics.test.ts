import { describe, expect, it } from "vitest";
import {
  formatBasisPointDiff,
  formatNumber,
  formatPercent,
  formatStatusLabel,
  summarizeSnapshot
} from "../lib/dashboardMetrics";
import { buildPath, buildSeries } from "../lib/chartGeometry";
import { seedSnapshot } from "../lib/seedSnapshot";

describe("dashboard metrics", () => {
  it("summarizes the seeded analytics snapshot", () => {
    const summary = summarizeSnapshot(seedSnapshot);

    expect(summary.rowCount).toBe(2);
    expect(summary.strikeRange).toEqual([5200, 5200]);
    expect(summary.averageIv).toBeCloseTo(0.183);
    expect(summary.totalAbsGamma).toBeCloseTo(0.0244);
    expect(summary.totalAbsVanna).toBeCloseTo(0.0082);
  });

  it("formats dashboard values consistently", () => {
    expect(formatPercent(0.184)).toBe("18.40%");
    expect(formatPercent(null)).toBe("—");
    expect(formatNumber(0.012345, 4)).toBe("0.0123");
    expect(formatNumber(null, 4)).toBe("—");
    expect(formatBasisPointDiff(-0.002)).toBe("-20.0 bp");
    expect(formatBasisPointDiff(null)).toBe("—");
    expect(formatStatusLabel("partial")).toBe("Partial");
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
