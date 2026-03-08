import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { UiThemeProvider } from "@/theme/ui-theme-provider";
import { UI_THEME_STORAGE_KEY } from "@/theme/ui-theme";

describe("ThemeSwitcher", () => {
  it("switches between hand-drawn and shadcn themes and persists the selection", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(UI_THEME_STORAGE_KEY);

    render(
      <UiThemeProvider>
        <ThemeSwitcher />
      </UiThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.uiTheme).toBe("hand-drawn");
    });

    await user.click(screen.getByRole("button", { name: /Plain/i }));

    await waitFor(() => {
      expect(document.documentElement.dataset.uiTheme).toBe("shadcn");
    });
    expect(window.localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("shadcn");
    expect(screen.getByRole("button", { name: /Plain/i })).toHaveAttribute("aria-pressed", "true");
  });
});
