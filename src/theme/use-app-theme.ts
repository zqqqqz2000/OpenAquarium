import { useContext } from "react";

import { ThemeContext } from "@/theme/theme-context";

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }

  return context;
}
