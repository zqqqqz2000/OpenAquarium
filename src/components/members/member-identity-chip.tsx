import type { TeamMember } from "@/domain/model";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getMemberRoleLabel, getMemberRoleMonogram, getMemberRolePalette } from "@/lib/member-display";
import { cn } from "@/lib/utils";

export function MemberIdentityChip(props: {
  member: TeamMember;
  label?: string;
  onClick?: () => void;
  className?: string;
  labelClassName?: string;
}) {
  const { member, label, onClick, className, labelClassName } = props;
  const roleLabel = label ?? getMemberRoleLabel(member.handle);
  const rolePalette = getMemberRolePalette(member.handle);
  const Root = onClick ? "button" : "div";

  return (
    <Root
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/70 px-1.5 py-1 text-left",
        onClick && "transition-colors hover:bg-background",
        className,
      )}
      onClick={onClick}
      {...(onClick ? { type: "button" as const } : {})}
    >
      <Avatar size="sm" className="ring-0 after:border-border/80">
        <AvatarFallback
          className="text-[10px] font-semibold"
          style={{ backgroundColor: rolePalette.background, color: rolePalette.foreground }}
        >
          {getMemberRoleMonogram(member.handle)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn("truncate text-[11px] font-semibold uppercase tracking-[0.16em]", labelClassName)}
        style={{ color: rolePalette.background }}
      >
        {roleLabel}
      </span>
    </Root>
  );
}
