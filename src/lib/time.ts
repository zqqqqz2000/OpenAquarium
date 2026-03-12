export interface FormatTimeOptions {
  timeZone?: string;
}

export function formatTime(isoTimestamp: string, options?: FormatTimeOptions): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date(isoTimestamp));
}
