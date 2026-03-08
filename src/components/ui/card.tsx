import type { HTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "paper" | "postit" | "blueprint" | "correction";
  tack?: boolean;
}

export function Card({ className, tone = "paper", tack = false, style, ...props }: CardProps) {
  return (
    <div
      className={cn("paper-card relative", tack && "thumbtack", className)}
      data-tone={tone}
      style={{ ...wobbly.md, ...style }}
      {...props}
    />
  );
}

