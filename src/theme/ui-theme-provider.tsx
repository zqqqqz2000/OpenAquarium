import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { UI_THEME_STORAGE_KEY, uiThemes, type UiTheme } from "@/theme/ui-theme";
import { UiThemeContext, type UiThemeContextValue } from "@/theme/ui-theme-context";

const defaultTheme: UiTheme = "hand-drawn";

function isUiTheme(value: string | null): value is UiTheme {
  return value !== null && uiThemes.includes(value as UiTheme);
}

function readInitialTheme(): UiTheme {
  if (typeof window === "undefined") {
    return defaultTheme;
  }

  const persistedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
  return isUiTheme(persistedTheme) ? persistedTheme : defaultTheme;
}

export function UiThemeProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [theme, setTheme] = useState<UiTheme>(readInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.uiTheme = theme;
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<UiThemeContextValue>(
    () => ({
      theme,
      setTheme,
    }),
    [theme],
  );

  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}
