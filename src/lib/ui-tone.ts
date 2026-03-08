import type { AccentTone, MemberStatus, MessageStatus } from "@/domain/model";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const surfaceClasses: Record<AccentTone, string> = {
  paper: "bg-[var(--tone-paper-surface)]",
  postit: "bg-[var(--tone-postit-surface)]",
  blueprint: "bg-[var(--tone-blueprint-surface)]",
  correction: "bg-[var(--tone-correction-surface)]",
};

const badgeClasses: Record<AccentTone, string> = {
  paper: "border-[color:var(--tone-paper-border)] bg-[var(--tone-paper-badge)] text-[var(--tone-paper-foreground)]",
  postit: "border-[color:var(--tone-postit-border)] bg-[var(--tone-postit-badge)] text-[var(--tone-postit-foreground)]",
  blueprint:
    "border-[color:var(--tone-blueprint-border)] bg-[var(--tone-blueprint-badge)] text-[var(--tone-blueprint-foreground)]",
  correction:
    "border-[color:var(--tone-correction-border)] bg-[var(--tone-correction-badge)] text-[var(--tone-correction-foreground)]",
};

export function surfaceToneClass(tone: AccentTone): string {
  return surfaceClasses[tone];
}

export function badgeToneProps(tone: AccentTone): { className: string; variant: BadgeVariant } {
  return {
    variant: "outline",
    className: badgeClasses[tone],
  };
}

export function memberStatusBadgeProps(status: MemberStatus): { className: string; variant: BadgeVariant } {
  switch (status) {
    case "running":
      return badgeToneProps("blueprint");
    case "interrupted":
      return badgeToneProps("correction");
    case "idle":
    default:
      return badgeToneProps("paper");
  }
}

export function messageStatusBadgeProps(status: MessageStatus): { className: string; variant: BadgeVariant } {
  switch (status) {
    case "completed":
      return badgeToneProps("blueprint");
    case "interrupted":
      return badgeToneProps("correction");
    case "streaming":
      return badgeToneProps("postit");
    case "sent":
    default:
      return badgeToneProps("paper");
  }
}
