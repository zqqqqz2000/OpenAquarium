export const UI_THEME_STORAGE_KEY = "oa-ui-theme";
export const uiThemes = ["hand-drawn", "shadcn"] as const;

export type UiTheme = (typeof uiThemes)[number];
