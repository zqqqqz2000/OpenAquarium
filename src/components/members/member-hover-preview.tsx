import type { ReactNode } from "react";

import type { TeamMember, WatchSubscription } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getMemberRoleLabel, getMemberRolePalette } from "@/lib/member-display";
import { badgeToneProps } from "@/lib/ui-tone";

export function MemberHoverPreview(props: {
  member: TeamMember;
  watcher?: WatchSubscription;
  children: ReactNode;
}) {
  const { member, watcher, children } = props;
  const toneBadge = badgeToneProps(member.accentTone);
  const roleLabel = getMemberRoleLabel(member.handle);
  const rolePalette = getMemberRolePalette(member.handle);

  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="left" align="start" sideOffset={12} className="w-[min(88vw,320px)] p-0">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div>
              <p className="m-0 text-lg font-semibold tracking-tight" style={{ color: rolePalette.background }}>
                {roleLabel}
              </p>
              <p className="m-0 text-sm text-muted-foreground">{member.name}</p>
            </div>
            <p className="m-0 text-sm leading-6 text-muted-foreground">{member.summary}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={toneBadge.variant} className={toneBadge.className}>
                {member.provider.label}
              </Badge>
              <Badge variant="secondary">{member.skills.length} skills</Badge>
              {member.isEntryMember ? <Badge variant="outline">Entry</Badge> : null}
              {member.acceptsDirectMessages ? <Badge variant="secondary">Direct inbox</Badge> : null}
              {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </HoverCardContent>
    </HoverCard>
  );
}
