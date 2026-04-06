export const enMessages = {
  locale: {
    label: "Language",
    english: "English",
    simplifiedChinese: "简体中文",
  },
  theme: {
    light: "Light",
    dark: "Dark",
  },
  sidebar: {
    runtimeOnline: "Runtime online",
    runtimeOffline: "Runtime offline",
    loading: "Loading…",
    subtitle: "ACP multi-agent workspace.",
    startRuntime: "Start the local runtime:",
    projects: "Projects",
  },
} as const;

export type EnMessages = typeof enMessages;
