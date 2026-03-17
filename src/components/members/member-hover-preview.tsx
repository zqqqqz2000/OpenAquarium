import type { ReactNode } from "react";

import type { TeamMember } from "@/domain/model";
import { Card, CardContent } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { getMemberRoleLabel } from "@/lib/member-display";

export function MemberHoverPreview(props: {
  member: TeamMember;
  latestPreview?: string;
  children: ReactNode;
}) {
  const { member, latestPreview, children } = props;
  const roleLabel = getMemberRoleLabel(member.handle);

  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={12}
        className="w-[min(88vw,320px)] p-0"
      >
        <Card size="sm">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
              <p className="m-0 text-base font-semibold tracking-tight">
                @{member.handle}
              </p>
              <p className="m-0 text-sm text-muted-foreground">{member.name}</p>
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {roleLabel}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2.5">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Latest update
              </p>
              <p className="mt-1 m-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                {latestPreview ?? "No recent visible update."}
              </p>
            </div>
          </CardContent>
        </Card>
      </HoverCardContent>
    </HoverCard>
  );
}
