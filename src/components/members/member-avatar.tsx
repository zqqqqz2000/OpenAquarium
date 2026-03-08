import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { Bot, Eye, Radio } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { cn, wobbly } from "@/lib/utils";

const toneClasses: Record<TeamMember["accentTone"], string> = {
  paper: "bg-white",
  postit: "bg-[var(--postit)]",
  blueprint: "bg-[color-mix(in_srgb,var(--blue)_16%,white)]",
  correction: "bg-[color-mix(in_srgb,var(--accent)_14%,white)]",
};

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
      <AvatarPrimitive.Root
        className={cn(
          "member-avatar-frame relative flex shrink-0 items-center justify-center",
          compact ? "h-12 w-12" : "h-14 w-14",
          active && "-rotate-2",
          toneClasses[member.accentTone],
        )}
        style={wobbly.sm}
      >
        <AvatarPrimitive.Fallback className="text-xl font-bold">{initials || <Bot size={20} strokeWidth={2.8} />}</AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {!compact ? (
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-xl">
            {member.name}
            {member.status === "running" ? <Radio size={16} className="text-[var(--accent)]" /> : null}
            {member.observeAllRoomMessages ? <Eye size={16} className="text-[var(--blue)]" /> : null}
          </span>
          <span className="block text-base opacity-70">@{member.handle}</span>
        </span>
      ) : null}
    </Root>
  );
}
