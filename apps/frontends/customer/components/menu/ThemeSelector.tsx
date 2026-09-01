"use client";

import { SegmentedTabs } from "@giromesa/ui";
import { useEffect, useState } from "react";
import {
  customerThemeStorageKey,
  normalizeThemePreference,
  resolveTheme,
  type ThemePreference,
} from "../../lib/theme";

const themeOptions: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Escuro" },
  { id: "system", label: "Sistema" },
];

function applyTheme(preference: ThemePreference, prefersDark: boolean) {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

export function ThemeSelector() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let stored: ThemePreference = "system";
    try {
      stored = normalizeThemePreference(window.localStorage.getItem(customerThemeStorageKey));
    } catch {
      // Storage can be unavailable in private or hardened browser contexts.
    }
    setPreference(stored);
    applyTheme(stored, media.matches);

    const followSystem = (event: MediaQueryListEvent) => {
      if (document.documentElement.dataset.themePreference === "system") {
        applyTheme("system", event.matches);
      }
    };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);

  function selectTheme(next: ThemePreference) {
    setPreference(next);
    try {
      window.localStorage.setItem(customerThemeStorageKey, next);
    } catch {
      // The selection still applies for the current page when persistence is blocked.
    }
    applyTheme(next, window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  return (
    <SegmentedTabs
      active={preference}
      className="customer-theme-selector"
      items={themeOptions}
      label="Aparência do cardápio"
      onChange={selectTheme}
    />
  );
}
