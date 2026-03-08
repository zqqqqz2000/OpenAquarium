import type { ComponentPropsWithoutRef } from "react";

import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn, wobbly } from "@/lib/utils";

export function Switch(props: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "rough-switch relative h-8 w-14 transition-colors data-[state=checked]:bg-[var(--blue)]",
      )}
      style={wobbly.pill}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "rough-switch-thumb block h-5 w-5 translate-x-[5px] bg-[var(--postit)] transition-transform data-[state=checked]:translate-x-[29px]",
        )}
        style={wobbly.pill}
      />
    </SwitchPrimitive.Root>
  );
}
