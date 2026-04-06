const USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
} as const;

export const USER_CHAT_IMAGE_ACCEPT_ATTRIBUTE = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ...new Set(Object.values(USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE)),
].join(",");

export interface UserChatAssetUploadResult {
  path: string;
  markdown: string;
}

export function resolveUserChatImageContentType(contentType?: string | null, fileName?: string): string | undefined {
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedContentType && Object.values(USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE).includes(normalizedContentType as never)) {
    return normalizedContentType;
  }

  const extension = getFileExtension(fileName);
  return extension ? USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE[extension] : undefined;
}

export function sanitizeUserChatAssetFileName(fileName: string, contentType?: string | null): string {
  const rawBaseName = fileName.split(/[\\/]/u).pop()?.trim() || "image";
  const extension = resolveUserChatImageExtension(contentType, rawBaseName);
  const rawExtension = getFileExtension(rawBaseName) ?? "";
  const stemSource = rawExtension ? rawBaseName.slice(0, -rawExtension.length) : rawBaseName;
  const sanitizedStem = stemSource
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-_.]+|[-_.]+$/gu, "")
    .slice(0, 80);

  return `${sanitizedStem || "image"}${extension}`;
}

export function deriveUserChatAssetAltText(fileName: string): string {
  const rawBaseName = fileName.split(/[\\/]/u).pop()?.trim() || "image";
  const rawExtension = getFileExtension(rawBaseName) ?? "";
  const stemSource = rawExtension ? rawBaseName.slice(0, -rawExtension.length) : rawBaseName;
  const normalized = stemSource
    .normalize("NFKC")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized || "image";
}

export function buildUserChatImageMarkdown(args: { assetPath: string; fileName: string }): string {
  return `![${escapeMarkdownText(deriveUserChatAssetAltText(args.fileName))}](${args.assetPath})`;
}

function resolveUserChatImageExtension(contentType?: string | null, fileName?: string): string {
  const currentExtension = getFileExtension(fileName);
  if (currentExtension && USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE[currentExtension]) {
    return currentExtension;
  }

  const resolvedContentType = resolveUserChatImageContentType(contentType, fileName);
  if (!resolvedContentType) {
    return currentExtension || ".png";
  }

  return (
    Object.entries(USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE).find(([, supportedContentType]) => supportedContentType === resolvedContentType)?.[0]
    ?? ".png"
  );
}

function getFileExtension(fileName?: string): keyof typeof USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE | undefined {
  if (!fileName) {
    return undefined;
  }

  const match = /\.[A-Za-z0-9]+$/u.exec(fileName.trim().toLowerCase());
  if (!match) {
    return undefined;
  }

  const extension = match[0] as keyof typeof USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE;
  return USER_CHAT_IMAGE_EXTENSION_TO_CONTENT_TYPE[extension] ? extension : undefined;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\[\]]/gu, "\\$&");
}
