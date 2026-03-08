import type { ComponentPropsWithoutRef } from "react";

import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn, wobbly } from "@/lib/utils";

export function Switch(props: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("rough-switch relative h-6 w-11 transition-colors")}
      style={wobbly.pill}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "rough-switch-thumb block h-5 w-5 translate-x-0.5 transition-transform data-[state=checked]:translate-x-[22px]",
        )}
        style={wobbly.pill}
      />
    </SwitchPrimitive.Root>
  );
}
