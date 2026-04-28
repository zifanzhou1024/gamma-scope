// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_STORAGE_KEY } from "../lib/themePreference";
import { ThemeToggle } from "../components/ThemeToggle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemeToggle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("renders a dark-default header switch", () => {
    const markup = renderToStaticMarkup(<ThemeToggle />);

    expect(markup).toContain("Theme");
    expect(markup).toContain("Dark");
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*aria-pressed="false"[^>]*aria-label="Switch to light mode"/);
  });

  it("toggles to light, applies the document theme, and saves storage", async () => {
    const { container, root } = renderThemeToggle();
    await act(async () => undefined);

    const button = getThemeToggleButton(container);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Light");

    cleanupRenderedThemeToggle(root, container);
  });

  it("toggles a saved light preference back to dark", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { container, root } = renderThemeToggle();
    await act(async () => undefined);

    const button = getThemeToggleButton(container);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toContain("Dark");

    cleanupRenderedThemeToggle(root, container);
  });
});

function renderThemeToggle() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ThemeToggle />);
  });

  return { container, root };
}

function cleanupRenderedThemeToggle(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function getThemeToggleButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[data-theme-toggle]");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}
