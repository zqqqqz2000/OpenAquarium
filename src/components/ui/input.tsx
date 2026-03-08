import type { InputHTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export function Input({ className, style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("rough-input h-10 w-full px-3 text-sm", className)}
      style={{ ...wobbly.sm, ...style }}
      {...props}
    />
  );
}
