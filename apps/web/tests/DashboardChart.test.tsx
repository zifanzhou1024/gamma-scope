import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardChart } from "../components/DashboardChart";
import type { AnalyticsSnapshot } from "../lib/contracts";

type Row = AnalyticsSnapshot["rows"][number];

const baseRows = [
  marketRow({ strike: 5190, right: "call", custom_iv: 0.212, custom_gamma: 0.0041, custom_vanna: -0.0012 }),
  marketRow({ strike: 5190, right: "put", custom_iv: 0.232, custom_gamma: 0.0039, custom_vanna: -0.001 }),
  marketRow({ strike: 5200, right: "call", custom_iv: 0.188, custom_gamma: 0.0185, custom_vanna: 0.0008 }),
  marketRow({ strike: 5200, right: "put", custom_iv: 0.205, custom_gamma: 0.018, custom_vanna: 0.001 }),
  marketRow({ strike: 5210, right: "call", custom_iv: 0.216, custom_gamma: 0.0062, custom_vanna: 0.0021 }),
  marketRow({ strike: 5210, right: "put", custom_iv: 0.224, custom_gamma: 0.006, custom_vanna: 0.0019 })
];

const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");

describe("DashboardChart", () => {
  it("renders split call and put IV market-ops axes", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart rows={baseRows} title="IV smile" metricKey="custom_iv" tone="blue" valueKind="percent" />
    );

    expect(markup).toContain("IV BY STRIKE");
    expect(markup).toContain("Call IV");
    expect(markup).toContain("Put IV");
    expect(markup).toContain("Strike");
    expect(markup).toContain("IV (%)");
    expect(markup).toContain('data-chart-grid="market-ops"');
    expect(markup).toContain('data-axis="x"');
    expect(markup).toContain('data-axis="y"');
    expect(markup).toContain('data-series="call-iv"');
    expect(markup).toContain('data-series="put-iv"');
  });

  it("marks the lowest IV points on the smile and summarizes them in a fixed badge", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart rows={baseRows} title="IV smile" metricKey="custom_iv" tone="blue" valueKind="percent" />
    );

    expect(markup).toContain('data-iv-min-marker="call-iv"');
    expect(markup).toContain('data-iv-min-marker="put-iv"');
    expect(markup).toContain('data-iv-min-summary="true"');
    expect(markup).toContain("IV LOW POINTS");
    expect(markup).toContain("Call 18.8% @ 5,200");
    expect(markup).toContain("Put 20.5% @ 5,200");
    expect(markup).not.toContain("<text>Call min");
    expect(markup).not.toContain("<text>Put min");
  });

  it("renders gamma and vanna market-ops titles, axes, and summary labels", () => {
    const gammaMarkup = renderToStaticMarkup(
      <DashboardChart rows={baseRows} title="Gamma by strike" metricKey="custom_gamma" tone="violet" valueKind="decimal" />
    );
    const vannaMarkup = renderToStaticMarkup(
      <DashboardChart rows={baseRows} title="Vanna by strike" metricKey="custom_vanna" tone="teal" valueKind="decimal" />
    );

    expect(gammaMarkup).toContain("GAMMA BY STRIKE");
    expect(gammaMarkup).toContain("Strike");
    expect(gammaMarkup).toContain("Gamma");
    expect(gammaMarkup).toContain("Current");
    expect(gammaMarkup).toContain("Min");
    expect(gammaMarkup).toContain("Max");

    expect(vannaMarkup).toContain("VANNA BY STRIKE");
    expect(vannaMarkup).toContain("Strike");
    expect(vannaMarkup).toContain("Vanna");
    expect(vannaMarkup).toContain("Current");
    expect(vannaMarkup).toContain("Min");
    expect(vannaMarkup).toContain("Max");
  });

  it("renders SPX spot and forward reference lines", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        spot={5199}
        forward={5202}
        atmValue={0.018}
      />
    );

    expect(markup).toContain('data-reference-line="spot"');
    expect(markup).toContain("SPX spot 5,199.00");
    expect(markup).toContain('data-reference-line="forward"');
    expect(markup).toContain("Forward 5,202.00");
    expect(markup).toContain("ATM Gamma");
    expect(markup).toContain("0.01800");
  });

  it("does not render spot or forward reference lines outside the x-domain", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        spot={5189}
        forward={5211}
      />
    );

    expect(markup).not.toContain('data-reference-line="spot"');
    expect(markup).not.toContain("SPX spot 5,189.00");
    expect(markup).not.toContain('data-reference-line="forward"');
    expect(markup).not.toContain("Forward 5,211.00");
  });

  it("places right-edge reference labels inside the chart", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        spot={5210}
      />
    );

    expect(markup).toContain('data-reference-line="spot"');
    expect(markup).toMatch(/data-reference-line="spot"[\s\S]*<text[^>]*text-anchor="end"[^>]*>SPX spot 5,210\.00<\/text>/);
  });

  it("renders a zero line on vanna charts when zero is inside the domain", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Vanna by strike"
        metricKey="custom_vanna"
        tone="teal"
        valueKind="decimal"
        spot={5200}
        forward={5200}
        atmValue={0.0018}
        showZeroLine
      />
    );

    expect(markup).toContain('data-zero-line="vanna"');
    expect(markup).toContain("Vanna 0");
    expect(markup).toContain("ATM Vanna");
  });

  it("does not render a vanna zero line for gamma or IV charts", () => {
    const zeroCrossingRows = [
      marketRow({ strike: 5190, right: "call", custom_iv: -0.01, custom_gamma: -0.001, custom_vanna: -0.001 }),
      marketRow({ strike: 5200, right: "put", custom_iv: 0.01, custom_gamma: 0.001, custom_vanna: 0.001 })
    ];
    const gammaMarkup = renderToStaticMarkup(
      <DashboardChart
        rows={zeroCrossingRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        showZeroLine
      />
    );
    const ivMarkup = renderToStaticMarkup(
      <DashboardChart rows={zeroCrossingRows} title="IV smile" metricKey="custom_iv" tone="blue" valueKind="percent" showZeroLine />
    );

    expect(gammaMarkup).not.toContain('data-zero-line="vanna"');
    expect(ivMarkup).not.toContain('data-zero-line="vanna"');
  });

  it("does not render a vanna zero line when zero is outside the y-domain", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows.map((row) => ({ ...row, custom_vanna: Math.abs(row.custom_vanna ?? 0.001) }))}
        title="Vanna by strike"
        metricKey="custom_vanna"
        tone="teal"
        valueKind="decimal"
        showZeroLine
      />
    );

    expect(markup).not.toContain('data-zero-line="vanna"');
    expect(markup).not.toContain("Vanna 0");
  });

  it("uses ATM summary labels for zero values and current labels for null ATM values", () => {
    const zeroMarkup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        atmValue={0}
      />
    );
    const nullMarkup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        atmValue={null}
      />
    );

    expect(zeroMarkup).toContain("ATM Gamma");
    expect(zeroMarkup).toContain("0.00000");
    expect(nullMarkup).toContain("Current");
    expect(nullMarkup).not.toContain("ATM Gamma");
  });

  it("uses green for call IV and red for put IV chart semantics", () => {
    expect(styles).toMatch(/--call-color:\s*var\(--green\)/);
    expect(styles).toMatch(/--put-color:\s*var\(--red\)/);
    expect(styles).toMatch(/\.chartSeries-call-iv path,\s*\n\.chartSeries-call-iv circle\s*{[\s\S]*stroke:\s*var\(--call-color\)/);
    expect(styles).toMatch(/\.chartSeries-put-iv path,\s*\n\.chartSeries-put-iv circle\s*{[\s\S]*stroke:\s*var\(--put-color\)/);
    expect(styles).toMatch(/\.ivMinSummaryItem-call-iv i\s*{[\s\S]*background:\s*var\(--call-color\)/);
    expect(styles).toMatch(/\.ivMinSummaryItem-put-iv i\s*{[\s\S]*background:\s*var\(--put-color\)/);
  });
});

function marketRow({ strike, right, ...overrides }: Partial<Row> & Pick<Row, "strike" | "right">): Row {
  return {
    contract_id: `SPXW-${right}-${strike}`,
    strike,
    right,
    bid: 1,
    ask: 1.2,
    mid: 1.1,
    custom_iv: null,
    custom_gamma: null,
    custom_vanna: null,
    open_interest: 100,
    ibkr_iv: null,
    ibkr_gamma: null,
    ibkr_vanna: null,
    iv_diff: null,
    gamma_diff: null,
    comparison_status: "missing",
    calc_status: "ok",
    ...overrides
  };
}
