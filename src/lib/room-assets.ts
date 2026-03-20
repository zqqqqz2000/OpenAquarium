import { resolveWorkspaceRuntimeBaseUrl } from "@/lib/runtime-client";

const EXTERNAL_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export function isRoomAssetUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("data:") || normalized.startsWith("blob:")) {
    return false;
  }

  return !EXTERNAL_URL_PATTERN.test(normalized);
}

export function resolveRoomAssetUrl(
  roomId: string | undefined,
  filePath: string,
  baseUrl = resolveWorkspaceRuntimeBaseUrl(),
): string {
  if (!roomId || !isRoomAssetUrl(filePath)) {
    return filePath;
  }

  const url = new URL(`${baseUrl}/api/rooms/${roomId}/assets`);
  url.searchParams.set("path", filePath);
  return url.toString();
}
