import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { I18nProvider } from "@/lib/i18n";
import { AppThemeProvider } from "@/theme/theme-provider";
import { APP_THEME_STORAGE_KEY } from "@/theme/theme";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("AppThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to the system light preference and applies document theme state", () => {
    mockMatchMedia(false);

    render(
      <I18nProvider>
        <AppThemeProvider>
          <ThemeToggle />
        </AppThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Light" }).getAttribute("data-state")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("light");
  });

  it("switches to dark mode and persists the selection", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <AppThemeProvider>
          <ThemeToggle />
        </AppThemeProvider>
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
  });
});
