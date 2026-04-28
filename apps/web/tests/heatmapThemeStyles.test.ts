import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

describe("heatmap theme styles", () => {
  it("defines shared heatmap cell palette tokens once", () => {
    expect(styles).toMatch(/--heatmap-positive-1:\s*#236a75;/);
    expect(styles).toMatch(/--heatmap-positive-2:\s*#2f8f88;/);
    expect(styles).toMatch(/--heatmap-positive-3:\s*#32b77b;/);
    expect(styles).toMatch(/--heatmap-positive-4:\s*#facc15;/);
    expect(styles).toMatch(/--heatmap-negative-1:\s*#315a80;/);
    expect(styles).toMatch(/--heatmap-negative-2:\s*#44307d;/);
    expect(styles).toMatch(/--heatmap-negative-3:\s*#5b006f;/);
    expect(styles).toMatch(/--heatmap-negative-4:\s*#4c005f;/);
    expect(styles.match(/--heatmap-positive-4:/g)).toHaveLength(1);
    expect(styles.match(/--heatmap-negative-4:/g)).toHaveLength(1);
  });

  it("defines light-mode heatmap shell overrides without redefining cell semantics", () => {
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-panel-bg:\s*#ffffff;/);
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-control-bg:\s*#ffffff;/);
    expect(styles).toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-table-head-bg:\s*#eef3f8;/);
    expect(styles).not.toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-positive-4:/);
    expect(styles).not.toMatch(/html\[data-theme="light"\]\s*{[\s\S]*--heatmap-negative-4:/);
  });

  it("maps existing heatmap cell classes to the shared palette tokens", () => {
    expect(styles).toMatch(/\.heatmapCell-intensity-4\.heatmapCell-positive\s*{[\s\S]*background:\s*var\(--heatmap-positive-4\);[\s\S]*color:\s*var\(--heatmap-positive-4-text\);/);
    expect(styles).toMatch(/\.heatmapCell-intensity-4\.heatmapCell-negative\s*{[\s\S]*background:\s*var\(--heatmap-negative-4\);[\s\S]*color:\s*var\(--heatmap-negative-4-text\);/);
    expect(styles).toMatch(/\.heatmapPanel\s*{[\s\S]*background:\s*var\(--heatmap-panel-bg\);/);
    expect(styles).toMatch(/\.heatmapPanelHeader\s*{[\s\S]*background:\s*var\(--heatmap-panel-header-bg\);/);
  });

  it("keeps the light heatmap table header token above generic table styles", () => {
    const genericLightTableHeaderIndex = styles.indexOf('html[data-theme="light"] th,');
    const heatmapLightTableHeaderIndex = styles.indexOf('html[data-theme="light"] .heatmapTable th');

    expect(genericLightTableHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(heatmapLightTableHeaderIndex).toBeGreaterThan(genericLightTableHeaderIndex);
    expect(styles.slice(heatmapLightTableHeaderIndex)).toMatch(/html\[data-theme="light"\]\s+\.heatmapTable th\s*{[\s\S]*background:\s*var\(--heatmap-table-head-bg\);/);
  });
});
