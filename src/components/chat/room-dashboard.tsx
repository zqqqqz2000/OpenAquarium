import type { ComponentType } from "react";

import { Activity, BarChart3, Clock3, MessagesSquare } from "lucide-react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buildRoomDashboardMetrics, formatDurationLabel } from "@/lib/room-dashboard";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

function MetricCard(props: { label: string; value: string; hint: string; icon: ComponentType<{ size?: number; className?: string }> }) {
  const { label, value, hint, icon: Icon } = props;

  return (
    <Card className="border-border/80 shadow-none">
      <CardContent className="flex items-start gap-3 p-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          <p className="m-0 mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="m-0 mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RoomDashboard(props: {
  snapshot: WorkspaceSnapshot;
  room: Room;
  members: TeamMember[];
  onOpenMember: (memberId: string) => void;
}) {
  const { snapshot, room, members, onOpenMember } = props;
  const metrics = buildRoomDashboardMetrics(snapshot, room, members);
  const maxCompletedTasks = Math.max(1, ...metrics.memberSummaries.map((member) => member.completedTaskCount));

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <MetricCard
          label="Tasks"
          value={String(metrics.totalTasks)}
          hint={`${metrics.completedTasks} completed, ${metrics.runningTasks} running`}
          icon={Activity}
        />
        <MetricCard
          label="Avg Duration"
          value={formatDurationLabel(metrics.averageTaskDurationMs)}
          hint="Average end-to-end task time in this room"
          icon={Clock3}
        />
        <MetricCard
          label="Room Replies"
          value={String(metrics.totalRoomReplies)}
          hint="Visible member replies sent back to the room"
          icon={MessagesSquare}
        />
        <MetricCard
          label="Active Members"
          value={String(metrics.memberSummaries.filter((member) => member.totalTaskCount > 0).length)}
          hint={`${members.length} members configured in this room`}
          icon={BarChart3}
        />
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold tracking-tight">Execution Timeline</p>
              <p className="m-0 text-xs text-muted-foreground">Shows task order, owner, status, and relative time span.</p>
            </div>
            <Badge variant="outline">{metrics.executionTimeline.length} tasks</Badge>
          </div>
          <div className="space-y-3">
            {metrics.executionTimeline.length > 0 ? (
              metrics.executionTimeline.map((span) => {
                const tone = badgeToneProps(
                  span.status === "completed" ? "blueprint" : span.status === "interrupted" ? "correction" : "postit",
                );

                return (
                  <button
                    key={span.taskId}
                    type="button"
                    className="w-full rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-left transition-colors hover:bg-muted/35"
                    onClick={() => onOpenMember(span.memberId)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold">
                          #{span.order} @{span.memberHandle}
                        </p>
                        <p className="m-0 mt-1 truncate text-xs text-muted-foreground">{span.taskTitle}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={tone.variant} className={tone.className}>
                          {span.status}
                        </Badge>
                        <Badge variant="outline">{formatDurationLabel(span.durationMs)}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-muted/65">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          span.status === "completed"
                            ? "bg-[color:var(--chart-1)]"
                            : span.status === "interrupted"
                              ? "bg-[color:var(--tone-correction-foreground)]"
                              : "bg-[color:var(--chart-4)]",
                        )}
                        style={{
                          marginLeft: `${Math.min(span.offsetRatio * 100, 96)}%`,
                          width: `${Math.min(span.spanRatio * 100, 100 - span.offsetRatio * 100)}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 px-3 py-5 text-sm text-muted-foreground">
                暂时还没有任务，dashboard 会在成员开始执行后自动出现顺序和耗时。
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 border-border/80 shadow-none">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold tracking-tight">Member Load</p>
              <p className="m-0 text-xs text-muted-foreground">Task throughput, average duration, and reply count per member.</p>
            </div>
            <Badge variant="outline">{members.length} members</Badge>
          </div>
          <div className="space-y-3">
            {metrics.memberSummaries.map((member) => (
              <button
                key={member.memberId}
                type="button"
                className="w-full rounded-2xl border border-border/70 bg-background/75 px-3 py-3 text-left transition-colors hover:bg-muted/35"
                onClick={() => onOpenMember(member.memberId)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold">@{member.handle}</p>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      {member.completedTaskCount} completed, {member.roomReplyCount} replies
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{member.status}</Badge>
                    <Badge variant="secondary">{formatDurationLabel(member.averageDurationMs)}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-full bg-muted/65">
                    <div
                      className="h-full rounded-full bg-[color:var(--chart-2)]"
                      style={{ width: `${Math.max((member.completedTaskCount / maxCompletedTasks) * 100, member.completedTaskCount > 0 ? 12 : 0)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-muted-foreground">{member.totalTaskCount} total</span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
