import { Bot, Eye, Radio } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { surfaceToneClass } from "@/lib/ui-tone";

export function MemberAvatar(props: {
  member: TeamMember;
  active?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const { member, active = false, compact = false, onClick } = props;
  const initials = member.name
    .split(" ")
    .map((segment) => segment[0])
    .join("")
    .slice(0, 2);
  const Root = onClick ? "button" : "div";

  return (
    <Root
      className={cn(
        "relative inline-flex items-center gap-3 text-left",
        compact ? "rounded-none" : "w-full rounded-none",
        onClick && "cursor-pointer",
      )}
      aria-label={onClick ? member.name : undefined}
      onClick={onClick}
      {...(onClick ? { type: "button" as const } : {})}
    >
      <Avatar
        className={cn(
          "shrink-0 ring-1 ring-border",
          compact ? "size-12" : "size-14",
          surfaceToneClass(member.accentTone),
          active && "ring-2 ring-ring/50 ring-offset-2 ring-offset-background",
        )}
      >
        <AvatarFallback className="bg-transparent text-sm font-semibold text-foreground">
          {initials || <Bot size={20} strokeWidth={2.2} />}
        </AvatarFallback>
      </Avatar>
      {!compact ? (
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-base font-semibold">
            {member.name}
            {member.status === "running" ? <Radio size={16} className="text-[color:var(--tone-blueprint-foreground)]" /> : null}
            {member.observeAllRoomMessages ? <Eye size={16} className="text-[color:var(--tone-blueprint-foreground)]" /> : null}
          </span>
          <span className="block text-sm text-muted-foreground">@{member.handle}</span>
        </span>
      ) : null}
    </Root>
  );
}
