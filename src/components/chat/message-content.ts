export const MESSAGE_BUBBLE_PREVIEW_CHAR_LIMIT = 1_200;

export function getCollapsedMessageContent(
  content: string,
  limit = MESSAGE_BUBBLE_PREVIEW_CHAR_LIMIT,
): {
  collapsed: boolean;
  preview: string;
} {
  if (content.length <= limit) {
    return {
      collapsed: false,
      preview: content,
    };
  }

  return {
    collapsed: true,
    preview: `${content.slice(0, limit)}\n\n[message collapsed]`,
  };
}
