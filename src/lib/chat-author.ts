import type { ChatAuthor } from "@/domain/model";

export function resolveChatAuthorActorKind(author: ChatAuthor): "human" | "bot" | "system" {
  if (author.actorKind) {
    return author.actorKind;
  }

  if (author.kind === "user" || author.kind === "human") {
    return "human";
  }

  if (author.kind === "member" || author.kind === "bot") {
    return "bot";
  }

  return "system";
}

export function resolveChatAuthorMemberId(author: ChatAuthor): string | undefined {
  if (author.kind === "member") {
    return author.id;
  }

  if (author.kind === "bot") {
    return author.memberId ?? author.id;
  }

  if (resolveChatAuthorActorKind(author) === "bot") {
    return author.memberId;
  }

  return undefined;
}

export function isHumanChatAuthor(author: ChatAuthor): boolean {
  return resolveChatAuthorActorKind(author) === "human";
}

export function isBotChatAuthor(author: ChatAuthor): boolean {
  return resolveChatAuthorActorKind(author) === "bot";
}

export function isSystemChatAuthor(author: ChatAuthor): boolean {
  return resolveChatAuthorActorKind(author) === "system";
}
