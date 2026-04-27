// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { AdminLoginPanel } from "../components/AdminLoginPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderAdminLoginPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AdminLoginPanel
        isAuthenticated={false}
        isAvailable={true}
        isSubmitting={false}
        errorMessage={null}
        onLogin={vi.fn()}
        onLogout={vi.fn()}
      />
    );
  });

  return { container, root };
}

function cleanupRenderedPanel(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("AdminLoginPanel interactions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closes the admin popover with Escape when focus is inside the username field", () => {
    const { container, root } = renderAdminLoginPanel();

    const trigger = container.querySelector<HTMLButtonElement>(".adminUtilityTrigger");
    expect(trigger).not.toBeNull();

    act(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const usernameInput = container.querySelector<HTMLInputElement>("input[autocomplete=\"username\"]");
    expect(usernameInput).not.toBeNull();

    act(() => {
      usernameInput?.focus();
      if (usernameInput) {
        usernameInput.value = "admin";
      }
      usernameInput?.dispatchEvent(new Event("input", { bubbles: true }));
      usernameInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector("input[autocomplete=\"username\"]")).toBeNull();
    expect(container.textContent).not.toContain("Username");
    expect(container.textContent).not.toContain("Password");

    cleanupRenderedPanel(root, container);
  });
});
