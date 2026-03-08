import { useContext } from "react";

import { UiThemeContext, type UiThemeContextValue } from "@/theme/ui-theme-context";

export function useUiTheme(): UiThemeContextValue {
  const context = useContext(UiThemeContext);

  if (!context) {
    throw new Error("UiThemeProvider is missing");
  }

  return context;
}
