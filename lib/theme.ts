"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Gray is the default for everyone. Dark is a per-device choice, kept in
 * localStorage and applied before first paint by the script in app/layout.tsx.
 */
export type Theme = "gray" | "dark";

const KEY = "huddle-theme";
const statusBar: Record<Theme, string> = { gray: "#5a5d62", dark: "#3a3a3d" };

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("gray");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "gray");
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "gray" : "dark";
      if (next === "dark") document.documentElement.dataset.theme = "dark";
      else delete document.documentElement.dataset.theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", statusBar[next]);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Private browsing can refuse storage; the choice then lasts until the page closes.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
