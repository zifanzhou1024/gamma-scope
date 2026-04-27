// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { deriveStrikeInspection } from "../lib/chartInspection";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { sortRowsByStrike } from "../lib/dashboardMetrics";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({
    title,
    inspectedStrike,
    inspection,
    onInspectStrike,
    onClearInspection
  }: {
    title: string;
    inspectedStrike?: number | null;
    inspection?: ReturnType<typeof deriveStrikeInspection>;
    onInspectStrike?: (strike: number) => void;
    onClearInspection?: () => void;
  }) => (
    <section
      data-chart-title={title}
      data-inspected-strike={inspectedStrike ?? ""}
      data-inspection-strike={inspection?.strike ?? ""}
      data-inspection-distance={inspection?.distanceLabel ?? ""}
      data-inspection-call-iv={inspection?.call.iv ?? ""}
      data-inspection-put-gamma={inspection?.put.gamma ?? ""}
    >
      <button type="button" data-action="inspect" onClick={() => onInspectStrike?.(5200)}>
        Inspect
      </button>
      <button type="button" data-action="clear" onClick={() => onClearInspection?.()}>
        Clear
      </button>
    </section>
  )
}));

describe("DashboardView chart inspection interactions", () => {
  const snapshot = {
    ...seedSnapshot,
    mode: "live",
    session_id: "dashboard-view-interaction-session",
    spot: 5201.25,
    forward: 5202.1
  } satisfies AnalyticsSnapshot;

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shares inspected strike and derived tooltip data across all charts", async () => {
    const { DashboardView } = await import("../components/DashboardView");
    const { container, root } = renderDashboardView(<DashboardView snapshot={snapshot} />);
    const expectedInspection = deriveStrikeInspection(sortRowsByStrike(snapshot.rows), 5200, snapshot.spot);

    expect(expectedInspection).not.toBeNull();
    assertAllCharts(container, {
      inspectedStrike: "",
      inspectionStrike: "",
      distance: "",
      callIv: "",
      putGamma: ""
    });

    clickChartButton(container, "GAMMA BY STRIKE", "inspect");

    assertAllCharts(container, {
      inspectedStrike: "5200",
      inspectionStrike: "5200",
      distance: expectedInspection?.distanceLabel ?? "",
      callIv: expectedInspection?.call.iv ?? "",
      putGamma: expectedInspection?.put.gamma ?? ""
    });

    clickChartButton(container, "IV BY STRIKE", "clear");

    assertAllCharts(container, {
      inspectedStrike: "",
      inspectionStrike: "",
      distance: "",
      callIv: "",
      putGamma: ""
    });

    cleanupRenderedDashboard(root, container);
  });
});

function renderDashboardView(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function cleanupRenderedDashboard(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function clickChartButton(container: HTMLElement, title: string, action: "inspect" | "clear") {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-chart-title="${title}"] button[data-action="${action}"]`
  );
  expect(button).not.toBeNull();

  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function assertAllCharts(
  container: HTMLElement,
  expected: {
    inspectedStrike: string;
    inspectionStrike: string;
    distance: string;
    callIv: string;
    putGamma: string;
  }
) {
  const charts = Array.from(container.querySelectorAll<HTMLElement>("[data-chart-title]"));
  expect(charts).toHaveLength(3);

  for (const chart of charts) {
    expect(chart.dataset.inspectedStrike).toBe(expected.inspectedStrike);
    expect(chart.dataset.inspectionStrike).toBe(expected.inspectionStrike);
    expect(chart.dataset.inspectionDistance).toBe(expected.distance);
    expect(chart.dataset.inspectionCallIv).toBe(expected.callIv);
    expect(chart.dataset.inspectionPutGamma).toBe(expected.putGamma);
  }
}
