import { Check, Palette } from "lucide-react";

import type { UiTheme } from "@/theme/ui-theme";
import { useUiTheme } from "@/theme/use-ui-theme";

const themeOptions: Array<{ id: UiTheme; label: string; description: string }> = [
  {
    id: "hand-drawn",
    label: "Hand-drawn",
    description: "当前手绘风格",
  },
  {
    id: "shadcn",
    label: "Plain",
    description: "朴素的 shadcn 风格",
  },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useUiTheme();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Palette size={16} />
        <p className="m-0 text-lg">Theme</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {themeOptions.map((option) => {
          const active = option.id === theme;

          return (
            <button
              key={option.id}
              aria-pressed={active}
              className="theme-chip"
              data-active={active ? "true" : "false"}
              type="button"
              onClick={() => setTheme(option.id)}
            >
              <span className="flex items-center gap-2">
                {active ? <Check size={14} /> : null}
                {option.label}
              </span>
              <span className="theme-chip-description">{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
