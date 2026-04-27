import React from "react";
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
