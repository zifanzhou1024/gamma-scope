import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "../../../packages/contracts/fixtures/experimental-flow.seed.json";
import type { ExperimentalFlow } from "../lib/contracts";

const seedPayload = seed as ExperimentalFlow;

const mocks = vi.hoisted(() => ({
  dashboardProps: vi.fn(),
  requestHeaders: vi.fn(() => new Headers({ host: "gamma.test" })),
  loadLatestExperimentalFlow: vi.fn()
}));

vi.mock("../lib/serverExperimentalFlowSource", () => ({
  loadLatestExperimentalFlow: mocks.loadLatestExperimentalFlow
}));

vi.mock("../components/ExperimentalFlowDashboard", () => ({
  ExperimentalFlowDashboard: (props: unknown) => {
    mocks.dashboardProps(props);
    return <div>Experimental 2 page shell</div>;
  }
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mocks.requestHeaders())
}));

describe("Experimental2Page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    mocks.dashboardProps.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers({ host: "gamma.test" }));
    mocks.loadLatestExperimentalFlow.mockReset();
  });

  it("loads the latest experimental flow server-side and passes it to the dashboard", async () => {
    const requestHeaders = new Headers({
      cookie: "gammascope_admin=signed-session",
      host: "gammascope.test",
      "x-forwarded-proto": "https"
    });
    const fetcher = vi.fn();
    mocks.requestHeaders.mockReturnValue(requestHeaders);
    mocks.loadLatestExperimentalFlow.mockResolvedValue(seedPayload);
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("React", React);

    const { default: Experimental2Page } = await import("../app/experimental-2/page");
    const page = await Experimental2Page();

    expect(renderToStaticMarkup(page)).toContain("Experimental 2 page shell");
    expect(mocks.loadLatestExperimentalFlow).toHaveBeenCalledWith(fetcher, requestHeaders);
    expect(mocks.dashboardProps).toHaveBeenCalledWith({
      initialFlow: seedPayload
    });
  });
});
