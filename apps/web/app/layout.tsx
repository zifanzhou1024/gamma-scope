import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "../lib/themePreference";
import "./styles.css";

export const metadata: Metadata = {
  title: "GammaScope",
  description: "SPX 0DTE analytics dashboard"
};

const themeInitScript = `
(function () {
  var theme = null;
  try {
    var storedTheme = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    if (storedTheme === "light" || storedTheme === "dark") {
      theme = storedTheme;
    }
  } catch (_) {}
  if (!theme) {
    try {
      var cookieMatch = document.cookie.match(/(?:^|; )${THEME_COOKIE_NAME}=(dark|light)(?:;|$)/);
      theme = cookieMatch ? cookieMatch[1] : null;
    } catch (_) {}
  }
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <Script id="gammascope-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
