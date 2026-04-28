"use client";

import React, { useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  applyThemePreference,
  browserThemePreferenceStorage,
  formatThemePreference,
  loadThemePreference,
  saveThemePreference
} from "../lib/themePreference";
import type { ThemePreference } from "../lib/themePreference";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME);
  const isLight = theme === "light";
  const nextTheme = isLight ? "dark" : "light";

  useEffect(() => {
    const loadedTheme = loadThemePreference(browserThemePreferenceStorage());
    setTheme(loadedTheme);
    applyThemePreference(loadedTheme);
  }, []);

  const handleToggle = () => {
    setTheme(nextTheme);
    applyThemePreference(nextTheme);
    saveThemePreference(nextTheme, browserThemePreferenceStorage());
  };

  return (
    <button
      type="button"
      className={`themeToggle themeToggle-${theme}`}
      data-theme-toggle={theme}
      aria-pressed={isLight}
      aria-label={`Switch to ${nextTheme} mode`}
      onClick={handleToggle}
    >
      <span className="themeToggleLabel">Theme</span>
      <span className="themeToggleTrack" aria-hidden="true">
        <span className="themeToggleThumb" />
      </span>
      <strong>{formatThemePreference(theme)}</strong>
    </button>
  );
}
