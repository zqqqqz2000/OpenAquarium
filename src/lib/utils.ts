import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const wobbly = {
  sm: { borderRadius: "var(--radius-sm)" },
  md: { borderRadius: "var(--radius-md)" },
  lg: { borderRadius: "var(--radius-lg)" },
  pill: { borderRadius: "var(--radius-pill)" },
  note: { borderRadius: "var(--radius-note)" },
  listItem: { borderRadius: "var(--radius-list-item)" },
  bubble: { borderRadius: "var(--radius-bubble)" },
};

export const tilt = {
  active: { transform: "rotate(var(--tilt-active))" },
  positive: { transform: "rotate(var(--tilt-positive))" },
  negative: { transform: "rotate(var(--tilt-negative))" },
};

export function formatTime(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoTimestamp));
}

export function summarizePrompt(prompt: string, maxLength = 84): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}
