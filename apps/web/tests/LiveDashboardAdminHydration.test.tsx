import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSnapshot } from "../lib/seedSnapshot";

const ADMIN_ENV = {
  NODE_ENV: "test",
  GAMMASCOPE_WEB_ADMIN_USERNAME: "admin",
  GAMMASCOPE_WEB_ADMIN_PASSWORD: "correct-horse-battery-staple",
  GAMMASCOPE_WEB_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy"
} as const;

const cookieValue = vi.fn(() => undefined as string | undefined);

vi.mock("../lib/snapshotSource", () => ({
  loadDashboardSnapshot: vi.fn(async () => seedSnapshot)
}));

vi.mock("../components/DashboardChart", () => ({
  DashboardChart: ({ title }: { title: string }) => <section>{title}</section>
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const value = cookieValue();
      return value ? { name, value } : undefined;
    })
  }))
}));

function setAdminEnv() {
  vi.stubEnv("NODE_ENV", ADMIN_ENV.NODE_ENV);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_USERNAME);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_PASSWORD);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
}

describe("Live dashboard admin hydration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    cookieValue.mockReset();
  });

  it("renders the live dashboard with authenticated top-bar admin state from the signed session cookie", async () => {
    vi.stubGlobal("React", React);
    setAdminEnv();
    const { createAdminSessionValue } = await import("../lib/adminSession");
    cookieValue.mockReturnValue(encodeURIComponent(createAdminSessionValue()));

    const { default: Home } = await import("../app/page");
    const markup = renderToStaticMarkup(await Home());

    expect(markup).toMatch(/class="adminUtility"[\s\S]*Authenticated[\s\S]*Log out/);
    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"[^>]*>Realtime<\/a>/);
    expect(markup).not.toContain("Username");
    expect(markup).not.toContain("Password");
    expect(markup).not.toContain("Replay import");
  });
});
