import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";

function LocaleButton(props: {
  active: boolean;
  className?: string;
  label: string;
  onClick: () => void;
}) {
  const { active, className, label, onClick } = props;

  return (
    <Button
      variant={active ? "default" : "ghost"}
      size="sm"
      className={cn("h-7 w-full gap-1.5 px-3", active ? "shadow-sm" : "text-muted-foreground", className)}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function LocaleToggle(props: { className?: string }) {
  const { className } = props;
  const { locale, setLocale, t } = useI18n();

  const applyLocale = (nextLocale: AppLocale) => {
    if (locale !== nextLocale) {
      setLocale(nextLocale);
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <Languages size={12} />
        <span>{t("locale.label")}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/70 p-0.5">
        <LocaleButton active={locale === "en"} label={t("locale.english")} onClick={() => applyLocale("en")} />
        <LocaleButton active={locale === "zh-CN"} label={t("locale.simplifiedChinese")} onClick={() => applyLocale("zh-CN")} />
      </div>
    </div>
  );
}
