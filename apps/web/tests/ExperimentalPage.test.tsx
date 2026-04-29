import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import type { ExperimentalAnalytics } from "../lib/contracts";

const seedPayload = seed as ExperimentalAnalytics;

const mocks = vi.hoisted(() => ({
  dashboardProps: vi.fn(),
  requestHeaders: vi.fn(() => new Headers({ host: "gamma.test" })),
  loadLatestExperimentalAnalytics: vi.fn()
}));

vi.mock("../lib/serverExperimentalAnalyticsSource", () => ({
  loadLatestExperimentalAnalytics: mocks.loadLatestExperimentalAnalytics
}));

vi.mock("../components/ExperimentalDashboard", () => ({
  ExperimentalDashboard: (props: unknown) => {
    mocks.dashboardProps(props);
    return <div>Experimental page shell</div>;
  }
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mocks.requestHeaders())
}));

describe("ExperimentalPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    mocks.dashboardProps.mockReset();
    mocks.requestHeaders.mockReset();
    mocks.requestHeaders.mockReturnValue(new Headers({ host: "gamma.test" }));
    mocks.loadLatestExperimentalAnalytics.mockReset();
  });

  it("loads the latest experimental analytics server-side and passes them to the dashboard", async () => {
    const requestHeaders = new Headers({
      cookie: "gammascope_admin=signed-session",
      host: "gammascope.test",
      "x-forwarded-proto": "https"
    });
    const fetcher = vi.fn();
    mocks.requestHeaders.mockReturnValue(requestHeaders);
    mocks.loadLatestExperimentalAnalytics.mockResolvedValue(seedPayload);
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("React", React);

    const { default: ExperimentalPage } = await import("../app/experimental/page");
    const page = await ExperimentalPage();

    expect(renderToStaticMarkup(page)).toContain("Experimental page shell");
    expect(mocks.loadLatestExperimentalAnalytics).toHaveBeenCalledWith(fetcher, requestHeaders);
    expect(mocks.dashboardProps).toHaveBeenCalledWith({
      initialAnalytics: seedPayload
    });
  });
});
