// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  applyThemePreference,
  browserThemePreferenceStorage,
  isThemePreference,
  loadThemePreference,
  saveThemePreference
} from "../lib/themePreference";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("themePreference", () => {
  afterEach(() => {
    document.cookie = `${THEME_COOKIE_NAME}=; Max-Age=0; Path=/`;
  });

  it("defaults to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(loadThemePreference(new MemoryStorage())).toBe("dark");
  });

  it("validates supported theme values", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("system")).toBe(false);
  });

  it("loads saved light preference and ignores invalid values", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "light");
    expect(loadThemePreference(storage)).toBe("light");

    storage.setItem(THEME_STORAGE_KEY, "bad");
    expect(loadThemePreference(storage)).toBe("dark");
  });

  it("falls back to a saved theme cookie when storage is unavailable", () => {
    const storage = {
      getItem() {
        throw new Error("Storage unavailable");
      }
    };
    document.cookie = `${THEME_COOKIE_NAME}=light; Path=/; SameSite=Lax`;

    expect(loadThemePreference(storage)).toBe("light");
  });

  it("saves selected preference", () => {
    const storage = new MemoryStorage();
    saveThemePreference("light", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=light`);
  });

  it("defaults to dark when storage getItem throws", () => {
    const storage = {
      getItem() {
        throw new Error("Storage unavailable");
      }
    };

    expect(loadThemePreference(storage)).toBe("dark");
  });

  it("ignores storage setItem failures when saving", () => {
    const storage = {
      setItem() {
        throw new Error("Storage unavailable");
      }
    };

    expect(() => saveThemePreference("light", storage)).not.toThrow();
  });

  it("returns null when browser localStorage property access throws", () => {
    const browser = {
      get localStorage(): Storage {
        throw new Error("localStorage unavailable");
      }
    };

    expect(browserThemePreferenceStorage(browser)).toBeNull();
  });

  it("applies the selected theme to the document element", () => {
    const element = document.createElement("html");

    applyThemePreference("light", element);
    expect(element.dataset.theme).toBe("light");

    applyThemePreference("dark", element);
    expect(element.dataset.theme).toBe("dark");
  });
});
