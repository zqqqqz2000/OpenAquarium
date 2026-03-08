import type { HTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "paper" | "postit" | "blueprint" | "correction";
}

export function Card({ className, tone = "paper", style, ...props }: CardProps) {
  return (
    <div
      className={cn("paper-card relative", className)}
      data-tone={tone}
      style={{ ...wobbly.md, ...style }}
      {...props}
    />
  );
}
