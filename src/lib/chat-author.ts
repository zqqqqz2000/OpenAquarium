import type { ChatAuthor, MemberId, RoomActorKind } from "@/domain/model";

export function resolveChatAuthorActorKind(author: ChatAuthor): RoomActorKind {
  if (author.actorKind === "human" || author.kind === "human" || author.kind === "user") {
    return "human";
  }
  if (author.actorKind === "system" || author.kind === "system") {
    return "system";
  }

  return "bot";
}

export function resolveChatAuthorMemberId(author: ChatAuthor): MemberId | undefined {
  return resolveChatAuthorActorKind(author) === "bot" ? author.memberId : undefined;
}
