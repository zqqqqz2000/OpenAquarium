import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export { formatTime } from "./time"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function summarizePrompt(prompt: string, maxLength = 84): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength - 1)}…`
}

export function summarizeLastLine(content: string, maxLength = 84): string {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const tail = (lines.at(-1) ?? content).replace(/\s+/g, " ").trim()

  if (!tail) {
    return ""
  }

  return summarizePrompt(tail, maxLength)
}
