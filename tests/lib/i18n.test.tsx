import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleToggle } from "@/components/theme/locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { APP_LOCALE_STORAGE_KEY, I18nProvider, resolveLocaleMessage } from "@/lib/i18n";
import { AppThemeProvider } from "@/theme/theme-provider";

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

describe("I18nProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
    delete document.documentElement.dataset.locale;
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches the locale, updates translated labels, and persists the selection", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <AppThemeProvider>
          <LocaleToggle />
          <ThemeToggle />
        </AppThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "简体中文" }));

    expect(screen.getByRole("button", { name: "浅色" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "深色" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dataset.locale).toBe("zh-CN");
    expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("falls back to English messages when a locale key is missing", () => {
    const catalog = {
      en: { sidebar: { projects: "Projects" } },
      "zh-CN": { sidebar: {} },
    };

    expect(resolveLocaleMessage("zh-CN", "sidebar.projects", catalog)).toBe("Projects");
    expect(resolveLocaleMessage("zh-CN", "sidebar.unknown", catalog)).toBe("sidebar.unknown");
  });
});
