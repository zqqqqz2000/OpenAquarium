import TextareaAutosize, { type TextareaAutosizeProps } from "react-textarea-autosize";

import { cn, wobbly } from "@/lib/utils";

export function Textarea({ className, style, ...props }: TextareaAutosizeProps) {
  return (
    <TextareaAutosize
      className={cn("rough-textarea min-h-28 w-full resize-none px-4 py-3 text-lg", className)}
      style={{ ...wobbly.md, ...style }}
      {...props}
    />
  );
}

