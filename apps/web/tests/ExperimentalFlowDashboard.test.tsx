// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "../../../packages/contracts/fixtures/experimental-flow.seed.json";
import type { ExperimentalFlow } from "../lib/contracts";

const seedPayload = seed as ExperimentalFlow;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  loadClientExperimentalFlow: vi.fn()
}));

vi.mock("../lib/clientExperimentalFlowSource", () => ({
  loadClientExperimentalFlow: mocks.loadClientExperimentalFlow
}));

describe("ExperimentalFlowDashboard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mocks.loadClientExperimentalFlow.mockReset();
  });

  it("renders the experimental flow cockpit shell with compact diagnostics", async () => {
    const { ExperimentalFlowDashboard } = await import("../components/ExperimentalFlowDashboard");
    const markup = renderToStaticMarkup(<ExperimentalFlowDashboard initialFlow={seedPayload} />);

    expect(markup).toContain("SPX 0DTE estimated flow");
    expect(markup).toContain("Estimated buy");
    expect(markup).toContain("Estimated sell");
    expect(markup).toContain("Dealer gamma pressure");
    expect(markup).toContain("Flow strike ladder");
    expect(markup).toContain("Aggressor mix");
    expect(markup).toContain("Open/close proxy");
    expect(markup).toContain("Contract audit");
    expect(markup).toContain("open_close_proxy_only");
  });

  it("polls latest experimental flow after mount and applies updated buy contracts", async () => {
    const livePayload = {
      ...seedPayload,
      summary: {
        ...seedPayload.summary,
        estimatedBuyContracts: 88
      }
    } satisfies ExperimentalFlow;
    mocks.loadClientExperimentalFlow.mockResolvedValue(livePayload);
    const { ExperimentalFlowDashboard } = await import("../components/ExperimentalFlowDashboard");
    const { container, root } = renderDashboard(<ExperimentalFlowDashboard initialFlow={seedPayload} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadClientExperimentalFlow).toHaveBeenCalled();
    expect(container.textContent).toContain("88");

    cleanup(root, container);
  });
});

function renderDashboard(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
