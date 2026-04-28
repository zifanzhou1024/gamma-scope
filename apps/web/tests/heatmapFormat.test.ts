import { describe, expect, it } from "vitest";
import {
  compactNodeLabel,
  exposureToneClass,
  formatHeatmapStatus,
  formatHeatmapTime
} from "../lib/heatmapFormat";

describe("exposureToneClass", () => {
  it("maps signs and color norms to stable CSS buckets", () => {
    expect(exposureToneClass(0, 1)).toBe("heatmapCell-neutral heatmapCell-intensity-4");
    expect(exposureToneClass(10, 0.1)).toBe("heatmapCell-positive heatmapCell-intensity-1");
    expect(exposureToneClass(-10, 0.49)).toBe("heatmapCell-negative heatmapCell-intensity-2");
    expect(exposureToneClass(-10, 0.74)).toBe("heatmapCell-negative heatmapCell-intensity-3");
    expect(exposureToneClass(10, 0.75)).toBe("heatmapCell-positive heatmapCell-intensity-4");
  });

  it("clamps invalid or out-of-range color norms", () => {
    expect(exposureToneClass(10, -1)).toBe("heatmapCell-positive heatmapCell-intensity-0");
    expect(exposureToneClass(10, Number.NaN)).toBe("heatmapCell-positive heatmapCell-intensity-0");
    expect(exposureToneClass(10, 10)).toBe("heatmapCell-positive heatmapCell-intensity-4");
  });
});

describe("formatHeatmapStatus", () => {
  it("labels live, stale, and delayed states", () => {
    expect(formatHeatmapStatus({ isLive: true, isStale: false })).toBe("LIVE");
    expect(formatHeatmapStatus({ isLive: true, isStale: true })).toBe("STALE");
    expect(formatHeatmapStatus({ isLive: false, isStale: false })).toBe("DELAYED");
  });
});

describe("formatHeatmapTime", () => {
  it("formats synced times in New York market time", () => {
    expect(formatHeatmapTime("2026-04-28T14:00:44Z")).toBe("10:00:44 AM");
  });

  it("returns an em dash for invalid times", () => {
    expect(formatHeatmapTime("not-a-date")).toBe("-");
  });
});

describe("compactNodeLabel", () => {
  it("formats compact strike and exposure labels", () => {
    expect(compactNodeLabel({ strike: 7175, value: -31_800_000 })).toBe("7175 -$31.8M");
    expect(compactNodeLabel(null)).toBe("-");
  });
});
