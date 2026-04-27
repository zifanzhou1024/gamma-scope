import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_LOGIN_POPOVER_ID,
  AdminLoginPanel,
  isAdminPopoverDismissKey
} from "../components/AdminLoginPanel";

describe("AdminLoginPanel", () => {
  it("renders logged-out admin access as a compact utility trigger", () => {
    const markup = renderToStaticMarkup(
      <AdminLoginPanel
        isAuthenticated={false}
        isAvailable={true}
        isSubmitting={false}
        errorMessage={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    expect(markup).toMatch(/class="adminUtility"/);
    expect(markup).toMatch(
      new RegExp(`<button[^>]*class="adminUtilityTrigger"[^>]*aria-expanded="false"[^>]*aria-controls="${ADMIN_LOGIN_POPOVER_ID}"[^>]*>Admin</button>`)
    );
    expect(markup).not.toContain("Username");
    expect(markup).not.toContain("Password");
    expect(markup).not.toContain("class=\"adminPanel\"");
  });

  it("renders authenticated admin status and logout as compact top-bar controls", () => {
    const markup = renderToStaticMarkup(
      <AdminLoginPanel
        isAuthenticated={true}
        isAvailable={true}
        isSubmitting={false}
        errorMessage={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    expect(markup).toMatch(/class="adminUtility"/);
    expect(markup).toContain("Authenticated");
    expect(markup).toContain("Log out");
    expect(markup).not.toContain("Username");
    expect(markup).not.toContain("Password");
    expect(markup).not.toContain("class=\"adminPanel\"");
  });

  it("treats Escape as the admin popover dismissal key", () => {
    expect(isAdminPopoverDismissKey("Escape")).toBe(true);
    expect(isAdminPopoverDismissKey("Enter")).toBe(false);
    expect(isAdminPopoverDismissKey("Tab")).toBe(false);
  });
});
