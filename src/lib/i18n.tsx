import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { enMessages, type EnMessages } from "@/locales/en";
import { zhCNMessages } from "@/locales/zh-CN";

export const APP_LOCALE_STORAGE_KEY = "openaquarium-locale";

export type AppLocale = "en" | "zh-CN";

type MessageTree = {
  [key: string]: string | MessageTree;
};

type LocalizedMessages<T> = {
  [Key in keyof T]: T[Key] extends string ? string : LocalizedMessages<T[Key]>;
};

export type MessageKey =
  | "locale.label"
  | "locale.english"
  | "locale.simplifiedChinese"
  | "theme.light"
  | "theme.dark"
  | "sidebar.runtimeOnline"
  | "sidebar.runtimeOffline"
  | "sidebar.loading"
  | "sidebar.subtitle"
  | "sidebar.startRuntime"
  | "sidebar.projects";

const messageCatalog = {
  en: enMessages,
  "zh-CN": zhCNMessages,
} satisfies Record<AppLocale, LocalizedMessages<EnMessages>>;

function resolveTreeValue(tree: MessageTree, key: string): string | undefined {
  return key.split(".").reduce<string | MessageTree | undefined>((value, segment) => {
    if (typeof value === "string" || !value) {
      return undefined;
    }

    return value[segment];
  }, tree) as string | undefined;
}

export function resolveLocaleMessage(locale: AppLocale, key: string, catalog: Record<AppLocale, MessageTree> = messageCatalog): string {
  return resolveTreeValue(catalog[locale], key) ?? resolveTreeValue(catalog.en, key) ?? key;
}

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "zh-CN";
}

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  if (isAppLocale(value)) {
    return value;
  }

  if (value?.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }

  return "en";
}

function getPreferredLocale(): AppLocale {
  if (typeof window === "undefined") {
    return "en";
  }

  return normalizeAppLocale(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY) ?? window.navigator.language);
}

export interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider(props: PropsWithChildren) {
  const { children } = props;
  const [locale, setLocale] = useState<AppLocale>(getPreferredLocale);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dataset.locale = locale;
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => resolveLocaleMessage(locale, key),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
