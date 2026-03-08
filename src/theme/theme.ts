export const APP_THEME_STORAGE_KEY = "openaquarium-theme";

export type AppTheme = "light" | "dark";

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  return value === "light" || value === "dark";
}

export function resolveInitialTheme(storedTheme: string | null | undefined, prefersDark: boolean): AppTheme {
  if (isAppTheme(storedTheme)) {
    return storedTheme;
  }

  return prefersDark ? "dark" : "light";
}
