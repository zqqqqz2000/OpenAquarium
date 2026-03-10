import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PanelToggleButton(props: {
  className?: string;
  collapsed: boolean;
  onToggle: () => void;
  side: "left" | "right";
}) {
  const { className, collapsed, onToggle, side } = props;
  const isLeft = side === "left";
  const label = isLeft ? "projects sidebar" : "members sidebar";
  const action = collapsed ? "Show" : "Hide";
  const Icon = collapsed
    ? isLeft
      ? PanelLeftOpen
      : PanelRightOpen
    : isLeft
      ? PanelLeftClose
      : PanelRightClose;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`${action} ${label}`}
          className={cn("shrink-0", className)}
          size="icon-sm"
          type="button"
          variant="outline"
          onClick={onToggle}
        >
          <Icon size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action} {label}</TooltipContent>
    </Tooltip>
  );
}
