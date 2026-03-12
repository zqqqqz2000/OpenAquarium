import { Bot, Eye, Radio } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { getMemberRoleLabel, getMemberRoleMonogram, getMemberRolePalette } from "@/lib/member-display";
import { cn } from "@/lib/utils";

export function MemberAvatar(props: {
  member: TeamMember;
  active?: boolean;
  compact?: boolean;
  showRunningDot?: boolean;
  onClick?: () => void;
}) {
  const { member, active = false, compact = false, showRunningDot = false, onClick } = props;
  const roleLabel = getMemberRoleLabel(member.handle);
  const roleMonogram = getMemberRoleMonogram(member.handle);
  const rolePalette = getMemberRolePalette(member.handle);
  const Root = onClick ? "button" : "div";

  return (
    <Root
      className={cn(
        "relative inline-flex items-center gap-3 text-left",
        compact ? "rounded-none" : "w-full rounded-none",
        onClick && "cursor-pointer",
      )}
      aria-label={onClick ? `${roleLabel} ${member.name}` : undefined}
      onClick={onClick}
      {...(onClick ? { type: "button" as const } : {})}
    >
      <Avatar
        className={cn(
          "shrink-0 ring-1 ring-border",
          compact ? "size-12" : "size-14",
          active && "ring-2 ring-ring/50 ring-offset-2 ring-offset-background",
        )}
      >
        {showRunningDot && member.status === "running" ? (
          <AvatarBadge aria-hidden="true" className="-top-0.5 -right-0.5 bottom-auto bg-emerald-500" />
        ) : null}
        <AvatarFallback className="text-sm font-semibold" style={{ backgroundColor: rolePalette.background, color: rolePalette.foreground }}>
          {roleMonogram || <Bot size={20} strokeWidth={2.2} />}
        </AvatarFallback>
      </Avatar>
      {!compact ? (
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate" style={{ color: rolePalette.background }}>
              {roleLabel}
            </span>
            {member.status === "running" ? <Radio size={16} className="text-[color:var(--tone-blueprint-foreground)]" /> : null}
            {member.observeAllRoomMessages ? <Eye size={16} className="text-[color:var(--tone-blueprint-foreground)]" /> : null}
          </span>
          <span className="block text-sm text-muted-foreground">{member.name}</span>
        </span>
      ) : null}
    </Root>
  );
}
