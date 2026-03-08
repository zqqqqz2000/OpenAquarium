import type { HTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "paper" | "postit" | "blueprint" | "correction";
}

export function Badge({ className, tone = "paper", style, ...props }: BadgeProps) {
  const toneClassName =
    tone === "postit"
      ? "bg-[var(--postit)]"
      : tone === "blueprint"
        ? "bg-[color-mix(in_srgb,var(--blue)_14%,white)]"
        : tone === "correction"
          ? "bg-[color-mix(in_srgb,var(--accent)_12%,white)]"
          : "bg-white";

  return (
    <span
      className={cn("inline-flex items-center border-[3px] border-[var(--ink)] px-3 py-1 text-sm uppercase tracking-[0.12em]", toneClassName, className)}
      style={{ ...wobbly.pill, ...style }}
      {...props}
    />
  );
}

