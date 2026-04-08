import {
  resolveWorkspaceRuntimeBaseUrl,
  resolveWorkspaceRuntimeRequestCredentials,
  resolveWorkspaceRuntimeRequestHeaders,
} from "@/lib/runtime-client";

const EXTERNAL_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

let activeRoomAssetBootstrap:
  | {
      sessionToken: string;
      promise: Promise<boolean>;
    }
  | undefined;

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

export function normalizeRoomAssetPath(filePath: string): string {
  const normalized = filePath.trim();

  if (!normalized || normalized.startsWith("//")) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return `.${normalized}`;
  }

  return normalized;
}

export function resolveRoomAssetUrl(
  roomId: string | undefined,
  filePath: string,
  baseUrl = resolveWorkspaceRuntimeBaseUrl(),
): string {
  const normalizedPath = normalizeRoomAssetPath(filePath);

  if (!roomId || !isRoomAssetUrl(normalizedPath)) {
    return filePath;
  }

  const url = new URL(`${baseUrl}/api/rooms/${roomId}/assets`);
  url.searchParams.set("path", normalizedPath);
  return url.toString();
}

export function shouldBootstrapRoomAssetSession(roomId: string | undefined, filePath: string): boolean {
  if (!roomId || !isRoomAssetUrl(normalizeRoomAssetPath(filePath))) {
    return false;
  }

  return Boolean(resolveWorkspaceRuntimeRequestHeaders().get("x-openaquarium-session")?.trim());
}

export async function ensureRoomAssetSessionCookie(): Promise<boolean> {
  const headers = resolveWorkspaceRuntimeRequestHeaders();
  const sessionToken = headers.get("x-openaquarium-session")?.trim();
  if (!sessionToken) {
    return false;
  }

  if (activeRoomAssetBootstrap?.sessionToken === sessionToken) {
    return activeRoomAssetBootstrap.promise;
  }

  const requestUrl = new URL(`${resolveWorkspaceRuntimeBaseUrl()}/api/auth/session`);
  const promise = fetch(requestUrl.toString(), {
    method: "GET",
    headers,
    credentials: resolveWorkspaceRuntimeRequestCredentials(),
  })
    .then((response) => {
      if (!response.ok) {
        return false;
      }

      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (activeRoomAssetBootstrap?.sessionToken === sessionToken) {
        activeRoomAssetBootstrap = undefined;
      }
    });

  activeRoomAssetBootstrap = {
    sessionToken,
    promise,
  };
  return promise;
}
