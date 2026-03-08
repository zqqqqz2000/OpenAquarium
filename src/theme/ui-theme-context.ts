import { createContext } from "react";

import type { UiTheme } from "@/theme/ui-theme";

export interface UiThemeContextValue {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
}

export const UiThemeContext = createContext<UiThemeContextValue | null>(null);
