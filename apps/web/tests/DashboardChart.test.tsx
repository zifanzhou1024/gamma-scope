// @vitest-environment happy-dom

import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardChart } from "../components/DashboardChart";
import type { AnalyticsSnapshot } from "../lib/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  afterEach(() => {
    document.body.innerHTML = "";
  });

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

  it("projects ticks references hit zones and inspection crosshair against a shared strike domain", () => {
    const narrowRows = baseRows.filter((row) => row.strike === 5190 || row.strike === 5200);
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={narrowRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        spot={5185}
        forward={5215}
        sharedStrikeDomain={[5180, 5220]}
        inspectedStrike={5190}
        inspection={{
          strike: 5190,
          distanceLabel: "-11 pts from spot",
          call: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "21.20%",
            gamma: "0.00410",
            vanna: "-0.00120",
            openInterest: "100"
          },
          put: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "23.20%",
            gamma: "0.00390",
            vanna: "-0.00100",
            openInterest: "100"
          }
        }}
        onInspectStrike={() => undefined}
        onClearInspection={() => undefined}
      />
    );

    expect(markup).toContain("5,180");
    expect(markup).toContain("5,220");
    expect(markup).toContain('data-reference-line="spot"');
    expect(markup).toContain("SPX spot 5,185.00");
    expect(markup).toContain('data-reference-line="forward"');
    expect(markup).toContain("Forward 5,215.00");
    expect(markup).toMatch(/data-inspection-crosshair="5190" x1="161" x2="161"/);
    expect(markup).toMatch(/data-chart-hit-strike="5190" x="42" y="42" width="178\.5"/);
  });

  it("keeps shared x-domain inspection affordances when the metric has no usable points", () => {
    const nullGammaRows = baseRows.map((row) => ({ ...row, custom_gamma: null }));
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={nullGammaRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        spot={5185}
        forward={5215}
        sharedStrikeDomain={[5180, 5220]}
        inspectedStrike={5190}
        inspection={{
          strike: 5190,
          distanceLabel: "-11 pts from spot",
          call: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "21.20%",
            gamma: "N/A",
            vanna: "-0.00120",
            openInterest: "100"
          },
          put: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "23.20%",
            gamma: "N/A",
            vanna: "-0.00100",
            openInterest: "100"
          }
        }}
        onInspectStrike={() => undefined}
        onClearInspection={() => undefined}
      />
    );

    expect(markup).toContain("5,180");
    expect(markup).toContain("5,220");
    expect(markup).toContain('data-reference-line="spot"');
    expect(markup).toContain("SPX spot 5,185.00");
    expect(markup).toContain('data-reference-line="forward"');
    expect(markup).toContain("Forward 5,215.00");
    expect(markup).toContain('data-chart-hit-strike="5190"');
    expect(markup).toContain('data-chart-hit-strike="5200"');
    expect(markup).toContain('data-chart-hit-strike="5210"');
    expect(markup).toMatch(/data-inspection-crosshair="5190" x1="161" x2="161"/);
    expect(markup).toContain('data-chart-inspection-chip="5190"');
    expect(markup).toContain("Call Γ N/A");
    expect(markup).toContain("Put Γ N/A");
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

  it("does not render strike hit zones without an inspection handler", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart rows={baseRows} title="Gamma by strike" metricKey="custom_gamma" tone="violet" valueKind="decimal" />
    );

    expect(markup).toContain('role="img"');
    expect(markup).not.toContain('role="group"');
    expect(markup).not.toContain("data-chart-hit-strike");
    expect(markup).not.toContain("Inspect 5,200");
  });

  it("renders strike hit zones for chart inspection", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        onInspectStrike={() => undefined}
        onClearInspection={() => undefined}
      />
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="GAMMA BY STRIKE interactive strike inspection"');
    expect(markup).not.toContain('role="img"');
    expect(markup).toContain('data-chart-hit-strike="5190"');
    expect(markup).toContain('data-chart-hit-strike="5200"');
    expect(markup).toContain('data-chart-hit-strike="5210"');
    expect(markup).toMatch(/<rect[^>]*data-chart-hit-strike="5200"[^>]*role="button"[^>]*aria-label="Inspect 5,200"/);
    expect(markup).toContain("Inspect 5,200");
  });

  it("inspects strikes through mouse, focus, and keyboard events but only clears from Escape", () => {
    const onInspectStrike = vi.fn();
    const onClearInspection = vi.fn();
    const { container, root } = renderInteractiveChart({ onInspectStrike, onClearInspection });
    const hitZone = container.querySelector<SVGRectElement>('[data-chart-hit-strike="5200"]');
    const chart = container.querySelector<SVGElement>("svg.chart");

    expect(hitZone).not.toBeNull();
    expect(chart).not.toBeNull();

    act(() => {
      hitZone?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(onInspectStrike).toHaveBeenLastCalledWith(5200);

    act(() => {
      hitZone?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(onInspectStrike).toHaveBeenLastCalledWith(5200);

    act(() => {
      hitZone?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onInspectStrike).toHaveBeenLastCalledWith(5200);

    act(() => {
      hitZone?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(onInspectStrike).toHaveBeenLastCalledWith(5200);

    act(() => {
      hitZone?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onClearInspection).not.toHaveBeenCalled();

    act(() => {
      chart?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(onClearInspection).not.toHaveBeenCalled();

    act(() => {
      hitZone?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClearInspection).toHaveBeenCalledTimes(1);

    cleanupRenderedChart(root, container);
  });

  it("renders synchronized crosshair without the full inspection tooltip table", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        inspectedStrike={5200}
        inspection={{
          strike: 5200,
          distanceLabel: "+1 pts from spot",
          call: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "18.80%",
            gamma: "0.01850",
            vanna: "0.00080",
            openInterest: "100"
          },
          put: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "20.50%",
            gamma: "0.01800",
            vanna: "0.00100",
            openInterest: "100"
          }
        }}
      />
    );

    expect(markup).toContain('data-inspection-crosshair="5200"');
    expect(markup).toContain('data-chart-inspection-chip="5200"');
    expect(markup).toContain("5,200");
    expect(markup).not.toContain("chartInspectionTooltip");
    expect(markup).not.toContain("Call and put inspection values");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("+1 pts from spot");
    expect(markup).not.toContain("Bid");
    expect(markup).not.toContain("Ask");
    expect(markup).not.toContain("Mid");
    expect(markup).not.toContain("OI");
  });

  it.each([
    { metricKey: "custom_iv" as const, title: "IV smile", tone: "blue" as const, valueKind: "percent" as const, callText: "Call IV 18.80%", putText: "Put IV 20.50%" },
    {
      metricKey: "custom_gamma" as const,
      title: "Gamma by strike",
      tone: "violet" as const,
      valueKind: "decimal" as const,
      callText: "Call Γ 0.01850",
      putText: "Put Γ 0.01800"
    },
    {
      metricKey: "custom_vanna" as const,
      title: "Vanna by strike",
      tone: "teal" as const,
      valueKind: "decimal" as const,
      callText: "Call Vanna 0.00080",
      putText: "Put Vanna 0.00100"
    }
  ])("renders a compact $metricKey inspection chip instead of a full tooltip table", ({ metricKey, title, tone, valueKind, callText, putText }) => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title={title}
        metricKey={metricKey}
        tone={tone}
        valueKind={valueKind}
        inspectedStrike={5200}
        inspection={{
          strike: 5200,
          distanceLabel: "+1 pts from spot",
          call: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "18.80%",
            gamma: "0.01850",
            vanna: "0.00080",
            openInterest: "100"
          },
          put: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "20.50%",
            gamma: "0.01800",
            vanna: "0.00100",
            openInterest: "100"
          }
        }}
        onInspectStrike={() => undefined}
        onClearInspection={() => undefined}
      />
    );

    expect(markup).toContain('data-chart-inspection-chip="5200"');
    expect(markup).toContain("5,200");
    expect(markup).toContain(callText);
    expect(markup).toContain(putText);
    expect(markup).not.toContain("chartInspectionTooltip");
    expect(markup).not.toContain("Call and put inspection values");
    expect(markup).not.toContain("<table");
  });

  it("does not render a compact inspection chip when the inspected strike is outside the chart domain", () => {
    const markup = renderToStaticMarkup(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        inspectedStrike={5225}
        inspection={{
          strike: 5225,
          distanceLabel: "+26 pts from spot",
          call: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "18.80%",
            gamma: "0.01850",
            vanna: "0.00080",
            openInterest: "100"
          },
          put: {
            bid: "1.00",
            ask: "1.20",
            mid: "1.10",
            iv: "20.50%",
            gamma: "0.01800",
            vanna: "0.00100",
            openInterest: "100"
          }
        }}
      />
    );

    expect(markup).not.toContain("data-inspection-crosshair");
    expect(markup).not.toContain("data-chart-inspection-chip");
  });

  it("uses green for call IV and red for put IV chart semantics", () => {
    expect(styles).toMatch(/--call-color:\s*var\(--green\)/);
    expect(styles).toMatch(/--put-color:\s*var\(--red\)/);
    expect(styles).toMatch(/\.chartSeries-call-iv path,\s*\n\.chartSeries-call-iv circle\s*{[\s\S]*stroke:\s*var\(--call-color\)/);
    expect(styles).toMatch(/\.chartSeries-put-iv path,\s*\n\.chartSeries-put-iv circle\s*{[\s\S]*stroke:\s*var\(--put-color\)/);
    expect(styles).toMatch(/\.ivMinSummaryItem-call-iv i\s*{[\s\S]*background:\s*var\(--call-color\)/);
    expect(styles).toMatch(/\.ivMinSummaryItem-put-iv i\s*{[\s\S]*background:\s*var\(--put-color\)/);
  });

  it("uses solid spot references and dashed forward references", () => {
    expect(styles).toMatch(/\.chartReferenceLine-spot line\s*{[\s\S]*stroke-dasharray:\s*none/);
    expect(styles).toMatch(/\.chartReferenceLine-forward line\s*{[\s\S]*stroke-dasharray:\s*4 5/);
  });

  it("contains chart panels and inspection chips within stable responsive layout bounds", () => {
    expect(styles).toMatch(/\.chartGrid\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(320px,\s*1fr\)\)/);
    expect(styles).toMatch(/\.chartPanel\s*{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:[\s\S]*minmax\(0,\s*300px\)[\s\S]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.chart\s*{[\s\S]*height:\s*300px;[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.chartInspectionChip\s*{[\s\S]*justify-content:\s*space-between;[\s\S]*overflow:\s*hidden/);
  });
});

function renderInteractiveChart({
  onInspectStrike,
  onClearInspection
}: {
  onInspectStrike: (strike: number) => void;
  onClearInspection: () => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <DashboardChart
        rows={baseRows}
        title="Gamma by strike"
        metricKey="custom_gamma"
        tone="violet"
        valueKind="decimal"
        onInspectStrike={onInspectStrike}
        onClearInspection={onClearInspection}
      />
    );
  });

  return { container, root };
}

function cleanupRenderedChart(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

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
