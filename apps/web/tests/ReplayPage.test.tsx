import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";

const requestHeaders = new Headers({ host: "gamma.test" });
const loadDashboardSnapshot = vi.fn(async () => seedSnapshot);

vi.mock("../lib/serverSnapshotSource", () => ({
  loadDashboardSnapshot
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => requestHeaders)
}));

vi.mock("../components/ReplayDashboard", () => ({
  ReplayDashboard: ({ requestedSessionId }: { requestedSessionId?: string | null }) => (
    <div data-requested-session-id={requestedSessionId ?? ""}>Replay page</div>
  )
}));

describe("ReplayPage", () => {
  it("passes session_id search params into the replay dashboard", async () => {
    vi.stubGlobal("React", React);
    const { default: ReplayPage } = await import("../app/replay/page");
    const page = await ReplayPage({
      searchParams: Promise.resolve({
        session_id: "import-session-ready"
      })
    });

    expect(loadDashboardSnapshot).toHaveBeenCalledWith({
      requestHeaders
    });
    expect(renderToStaticMarkup(page)).toContain("data-requested-session-id=\"import-session-ready\"");
  });
});
