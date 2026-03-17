import * as EditorModule from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-json";

import { cn } from "@/lib/utils";

const Editor = ("default" in EditorModule ? EditorModule.default : EditorModule) as typeof EditorModule.default;

export function JsonEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { value, onChange, placeholder, className } = props;

  return (
    <div
      className={cn(
        "oa-json-editor overflow-hidden rounded-lg border border-transparent bg-transparent text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={(code) => Prism.highlight(code, Prism.languages.json, "json")}
        padding={10}
        textareaId={undefined}
        textareaClassName="oa-json-editor__textarea"
        preClassName="oa-json-editor__pre"
        className="oa-json-editor__root min-h-28"
        placeholder={placeholder}
      />
    </div>
  );
}
