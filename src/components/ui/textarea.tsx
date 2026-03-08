import TextareaAutosize, { type TextareaAutosizeProps } from "react-textarea-autosize";

import { cn, wobbly } from "@/lib/utils";

export function Textarea({ className, style, ...props }: TextareaAutosizeProps) {
  return (
    <TextareaAutosize
      className={cn("rough-textarea min-h-28 w-full resize-none px-3 py-2 text-sm", className)}
      style={{ ...wobbly.md, ...style }}
      {...props}
    />
  );
}
