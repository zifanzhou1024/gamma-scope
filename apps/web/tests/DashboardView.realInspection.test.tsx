// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DashboardView } from "../components/DashboardView";
import { seedSnapshot } from "../lib/seedSnapshot";
import type { AnalyticsSnapshot } from "../lib/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DashboardView real chart inspection interactions", () => {
  const snapshot = {
    ...seedSnapshot,
    mode: "live",
    session_id: "dashboard-view-real-inspection-session",
    spot: 5201.25,
    forward: 5202.1
  } satisfies AnalyticsSnapshot;

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the shared inspector reachable after chart mouseout and hit-zone blur until Clear is clicked", () => {
    const { container, root } = renderDashboardView(<DashboardView snapshot={snapshot} />);
    const chart = getChart(container, "GAMMA BY STRIKE");
    const svg = chart.querySelector<SVGElement>("svg.chart");
    const hitZone = chart.querySelector<SVGRectElement>('[data-chart-hit-strike="5200"]');

    expect(svg).not.toBeNull();
    expect(hitZone).not.toBeNull();
    expect(container.querySelector("[data-shared-inspection-bar]")).toBeNull();

    act(() => {
      hitZone?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const sharedBar = getSharedInspectionBar(container);
    expect(sharedBar.textContent).toContain("5,200");
    expect(container.querySelectorAll("[data-inspection-crosshair]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-chart-inspection-chip]")).toHaveLength(3);

    act(() => {
      svg?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: sharedBar }));
    });
    expect(getSharedInspectionBar(container)).toBe(sharedBar);
    expect(container.querySelectorAll("[data-inspection-crosshair]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-chart-inspection-chip]")).toHaveLength(3);

    act(() => {
      hitZone?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: sharedBar }));
    });
    expect(getSharedInspectionBar(container)).toBe(sharedBar);
    expect(container.querySelectorAll("[data-inspection-crosshair]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-chart-inspection-chip]")).toHaveLength(3);

    clickSharedClear(sharedBar);

    expect(container.querySelector("[data-shared-inspection-bar]")).toBeNull();
    expect(container.querySelectorAll("[data-inspection-crosshair]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-chart-inspection-chip]")).toHaveLength(0);

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

function getChart(container: HTMLElement, title: string): HTMLElement {
  const chart = Array.from(container.querySelectorAll<HTMLElement>(".chartPanel")).find(
    (element) => element.getAttribute("aria-label") === title
  );

  expect(chart).not.toBeUndefined();
  return chart as HTMLElement;
}

function getSharedInspectionBar(container: HTMLElement): HTMLElement {
  const sharedBars = container.querySelectorAll<HTMLElement>("[data-shared-inspection-bar]");
  expect(sharedBars).toHaveLength(1);
  return sharedBars[0];
}

function clickSharedClear(sharedBar: HTMLElement) {
  const clearButton = sharedBar.querySelector<HTMLButtonElement>("button");
  expect(clearButton).not.toBeNull();

  act(() => {
    clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
