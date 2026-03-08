import { useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { APP_THEME_STORAGE_KEY, resolveInitialTheme, type AppTheme } from "@/theme/theme";
import { ThemeContext } from "@/theme/theme-context";

function getPreferredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return resolveInitialTheme(
    window.localStorage.getItem(APP_THEME_STORAGE_KEY),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

export function AppThemeProvider(props: PropsWithChildren) {
  const { children } = props;
  const [theme, setTheme] = useState<AppTheme>(getPreferredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
