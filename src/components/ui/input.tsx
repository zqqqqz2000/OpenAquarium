import type { InputHTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

export function Input({ className, style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("rough-input h-12 w-full px-4 text-lg", className)}
      style={{ ...wobbly.pill, ...style }}
      {...props}
    />
  );
}

