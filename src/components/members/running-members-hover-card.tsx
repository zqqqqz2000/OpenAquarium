import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export interface RunningMemberPreview {
  roomId: string;
  memberId: string;
  memberName: string;
  memberHandle: string;
  latestContentPreview?: string;
}

export function RunningMembersHoverCard(props: {
  members: RunningMemberPreview[];
  side?: "bottom" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  onOpenMember?: (preview: RunningMemberPreview) => void;
  children: ReactNode;
}) {
  const {
    members,
    side = "bottom",
    align = "start",
    sideOffset = 10,
    onOpenMember,
    children,
  } = props;

  if (members.length === 0 || !onOpenMember) {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={0} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className="w-[min(24rem,calc(100vw-2rem))] max-h-[min(70vh,calc(100vh-2rem))] overflow-y-auto p-0"
      >
        <div className="flex flex-col gap-2 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Running members
            </p>
            <Badge variant="outline" className="text-[10px]">
              {members.length}
            </Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            {members.map((member) => (
              <button
                key={`${member.roomId}:${member.memberId}`}
                type="button"
                className={cn(
                  "flex w-full flex-col items-start gap-1 rounded-xl border border-border/70 bg-background px-3 py-2 text-left transition-colors",
                  "hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenMember(member);
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full animate-oa-breathe bg-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_0.24rem_rgba(113,113,255,0.12)]"
                  />
                  <p className="m-0 truncate text-sm font-semibold tracking-tight">
                    @{member.memberHandle}
                  </p>
                  <span className="truncate text-xs text-muted-foreground">
                    {member.memberName}
                  </span>
                </div>
                <p className="m-0 w-full truncate text-xs text-muted-foreground">
                  {member.latestContentPreview ||
                    "Waiting for the next visible update."}
                </p>
              </button>
            ))}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
