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
const liveDashboardProps = vi.fn();

vi.mock("../lib/snapshotSource", () => ({
  loadDashboardSnapshot: vi.fn(async () => seedSnapshot)
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const value = cookieValue();
      return value ? { name, value } : undefined;
    })
  }))
}));

vi.mock("../components/LiveDashboard", () => ({
  LiveDashboard: (props: unknown) => {
    liveDashboardProps(props);
    return <div>Live dashboard</div>;
  }
}));

function setAdminEnv() {
  vi.stubEnv("NODE_ENV", ADMIN_ENV.NODE_ENV);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_USERNAME);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_PASSWORD);
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", ADMIN_ENV.GAMMASCOPE_WEB_ADMIN_SESSION_SECRET);
}

describe("Home page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    cookieValue.mockReset();
    liveDashboardProps.mockReset();
  });

  it("passes the authenticated admin session into the live dashboard top-bar state", async () => {
    vi.stubGlobal("React", React);
    setAdminEnv();
    const { createAdminSessionValue, parseAdminSessionValue } = await import("../lib/adminSession");
    const sessionValue = createAdminSessionValue();
    const session = parseAdminSessionValue(sessionValue);
    cookieValue.mockReturnValue(encodeURIComponent(sessionValue));

    const { default: Home } = await import("../app/page");
    const page = await Home();

    expect(renderToStaticMarkup(page)).toContain("Live dashboard");
    expect(liveDashboardProps).toHaveBeenCalledWith({
      initialSnapshot: seedSnapshot,
      initialAdminSession: {
        authenticated: true,
        csrfToken: session?.csrf_token,
        isAvailable: true
      }
    });
  });
});
