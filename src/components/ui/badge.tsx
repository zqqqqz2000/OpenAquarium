import type { HTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "paper" | "postit" | "blueprint" | "correction";
}

export function Badge({ className, tone = "paper", style, ...props }: BadgeProps) {
  const toneClassName =
    tone === "postit"
      ? "bg-[color-mix(in_srgb,var(--postit)_62%,white)]"
      : tone === "blueprint"
        ? "bg-[color-mix(in_srgb,var(--blue)_12%,white)]"
        : tone === "correction"
          ? "bg-[color-mix(in_srgb,var(--destructive)_10%,white)]"
          : "bg-[var(--muted)]";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)]",
        toneClassName,
        className,
      )}
      style={{ ...wobbly.pill, ...style }}
      {...props}
    />
  );
}
