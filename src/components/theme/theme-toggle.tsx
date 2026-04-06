import type { ReactNode } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppTheme } from "@/theme/theme";
import { useAppTheme } from "@/theme/use-app-theme";

function ThemeButton(props: {
  active: boolean;
  className?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const { active, className, icon, label, onClick } = props;

  return (
    <Button
      variant={active ? "default" : "ghost"}
      size="sm"
      className={cn("h-7 w-full gap-1.5 px-3", active ? "shadow-sm" : "text-muted-foreground", className)}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

export function ThemeToggle(props: { className?: string }) {
  const { className } = props;
  const { theme, setTheme } = useAppTheme();
  const { t } = useI18n();

  const applyTheme = (nextTheme: AppTheme) => {
    if (theme !== nextTheme) {
      setTheme(nextTheme);
    }
  };

  return (
    <div className={cn("grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/70 p-0.5", className)}>
      <ThemeButton active={theme === "light"} icon={<Sun size={14} />} label={t("theme.light")} onClick={() => applyTheme("light")} />
      <ThemeButton active={theme === "dark"} icon={<Moon size={14} />} label={t("theme.dark")} onClick={() => applyTheme("dark")} />
    </div>
  );
}
