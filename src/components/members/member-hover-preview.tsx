import type { ReactNode } from "react";

import * as Tooltip from "@radix-ui/react-tooltip";

import type { TeamMember, WatchSubscription } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function MemberHoverPreview(props: {
  member: TeamMember;
  watcher?: WatchSubscription;
  children: ReactNode;
}) {
  const { member, watcher, children } = props;

  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="z-50 w-[min(88vw,320px)]" side="top" sideOffset={12}>
            <Card className="flex flex-col gap-3 p-4" tone={member.accentTone}>
              <div>
                <p className="m-0 text-lg font-semibold tracking-tight">{member.name}</p>
                <p className="m-0 text-sm text-[var(--muted-foreground)]">@{member.handle}</p>
              </div>
              <p className="m-0 text-sm leading-6 text-[var(--muted-foreground)]">{member.summary}</p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="paper">{member.provider.label}</Badge>
                <Badge tone="blueprint">{member.skills.length} skills</Badge>
                {member.isEntryMember ? <Badge tone="postit">Entry</Badge> : null}
                {member.observeAllRoomMessages ? <Badge tone="blueprint">Monitor all</Badge> : null}
                {member.acceptsDirectMessages ? <Badge tone="paper">Direct inbox</Badge> : null}
                {watcher ? <Badge tone="correction">Watcher {watcher.intervalMinutes}m</Badge> : null}
              </div>
              <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Click to open member studio</p>
            </Card>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
