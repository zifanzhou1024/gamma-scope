export const THEME_STORAGE_KEY = "gammascope:theme";
export const THEME_COOKIE_NAME = "gammascope_theme";
export const THEME_OPTIONS = ["dark", "light"] as const;
export const DEFAULT_THEME = "dark" satisfies ThemePreference;

export type ThemePreference = (typeof THEME_OPTIONS)[number];
type ThemePreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type ThemePreferenceBrowser = {
  readonly localStorage: ThemePreferenceStorage;
};
type ThemePreferenceCookieDocument = Pick<Document, "cookie">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEME_OPTIONS.includes(value as ThemePreference);
}

export function loadThemePreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
  cookieDocument: ThemePreferenceCookieDocument | null | undefined = defaultThemeCookieDocument()
): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(value)) {
      return value;
    }
  } catch {
    // Fall through to the cookie fallback.
  }

  return loadThemePreferenceCookie(cookieDocument) ?? DEFAULT_THEME;
}

export function saveThemePreference(
  value: ThemePreference,
  storage: Pick<Storage, "setItem"> | null | undefined,
  cookieDocument: ThemePreferenceCookieDocument | null | undefined = defaultThemeCookieDocument()
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable in private browsing or restricted environments.
  }

  saveThemePreferenceCookie(value, cookieDocument);
}

export function applyThemePreference(
  value: ThemePreference,
  element: HTMLElement | null | undefined = typeof document === "undefined" ? null : document.documentElement
): void {
  try {
    if (element) {
      element.dataset.theme = value;
    }
  } catch {
    // Document access can be restricted in unusual embedded browser contexts.
  }
}

export function browserThemePreferenceStorage(
  browser: ThemePreferenceBrowser | null | undefined = typeof window === "undefined" ? null : window
): ThemePreferenceStorage | null {
  try {
    return browser?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function formatThemePreference(value: ThemePreference): string {
  return value === "light" ? "Light" : "Dark";
}

function defaultThemeCookieDocument(): ThemePreferenceCookieDocument | null {
  return typeof document === "undefined" ? null : document;
}

function loadThemePreferenceCookie(cookieDocument: ThemePreferenceCookieDocument | null | undefined): ThemePreference | null {
  try {
    const cookie = cookieDocument?.cookie ?? "";
    const cookieParts = cookie.split(";").map((part) => part.trim());
    const themeCookie = cookieParts.find((part) => part.startsWith(`${THEME_COOKIE_NAME}=`));
    const value = themeCookie?.slice(THEME_COOKIE_NAME.length + 1);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

function saveThemePreferenceCookie(
  value: ThemePreference,
  cookieDocument: ThemePreferenceCookieDocument | null | undefined
): void {
  try {
    if (cookieDocument) {
      cookieDocument.cookie = `${THEME_COOKIE_NAME}=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
    }
  } catch {
    // Cookie writes are best-effort and should not block theme changes.
  }
}
