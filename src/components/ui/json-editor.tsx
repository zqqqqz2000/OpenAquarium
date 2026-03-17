import { useRef } from "react";

import Prism from "prismjs";
import "prismjs/components/prism-json";

import { cn } from "@/lib/utils";

function normalizeEditorContent(value: string, placeholder?: string): string {
  const source = value.length > 0 ? value : (placeholder ?? "");
  const highlighted = Prism.highlight(source, Prism.languages.json, "json");

  // Keep the final line box visible while editing a trailing newline.
  return `${highlighted}${source.endsWith("\n") ? "\n" : ""}`;
}

export function JsonEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { value, onChange, placeholder, className } = props;
  const preRef = useRef<HTMLPreElement | null>(null);

  return (
    <div
      className={cn(
        "oa-json-editor overflow-hidden rounded-lg border border-transparent bg-transparent text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      <pre
        ref={preRef}
        aria-hidden="true"
        className={cn(
          "oa-json-editor__surface pointer-events-none min-h-28 overflow-auto",
          value.length === 0 && "opacity-70",
        )}
      >
        <code
          className="language-json"
          dangerouslySetInnerHTML={{
            __html: normalizeEditorContent(value, placeholder),
          }}
        />
      </pre>
      <textarea
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
        onScroll={(event) => {
          if (!preRef.current) {
            return;
          }

          preRef.current.scrollTop = event.currentTarget.scrollTop;
          preRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        className="oa-json-editor__textarea min-h-28 w-full resize-y bg-transparent"
      />
    </div>
  );
}
