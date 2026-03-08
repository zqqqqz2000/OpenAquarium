import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn, wobbly } from "@/lib/utils";

const buttonVariants = cva(
  "rough-button inline-flex h-12 items-center justify-center gap-2 px-4 text-lg tracking-wide disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "",
        ghost: "bg-transparent shadow-none",
      },
      size: {
        default: "min-w-28",
        sm: "h-10 px-3 text-base",
        icon: "h-11 w-11 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, style, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      data-variant={variant === "secondary" ? "secondary" : undefined}
      style={{ ...wobbly.pill, ...style }}
      {...props}
    />
  );
}

