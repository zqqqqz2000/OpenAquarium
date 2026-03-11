import { describe, expect, it } from "vitest";

import {
  addEmptyTemplateMemberDraft,
  buildTemplateConfigInput,
  createTemplateConfigDraft,
  removeTemplateMemberDraft,
} from "@/lib/template-config-draft";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("template config draft helpers", () => {
  it("adds a new member draft by inheriting stable provider defaults", () => {
    const snapshot = createSeedWorkspace();
    const template = snapshot.templates[snapshot.templateOrder[0]];
    const draft = createTemplateConfigDraft(template);

    const nextMembers = addEmptyTemplateMemberDraft(draft.members, {
      templateAccentTone: draft.accentTone,
      baseMember: draft.members[0],
    });
    const addedMember = nextMembers.at(-1);

    expect(addedMember).toBeDefined();
    expect(addedMember?.id).toMatch(/^member-\d+$/u);
    expect(addedMember?.handle).toBe(addedMember?.id);
    expect(addedMember?.provider.command).toBe(draft.members[0]?.provider.command);
    expect(addedMember?.provider).not.toBe(draft.members[0]?.provider);
    expect(addedMember?.prompt.length).toBeGreaterThan(0);
  });

  it("reassigns the entry member after deleting the current entry", () => {
    const snapshot = createSeedWorkspace();
    const template = snapshot.templates[snapshot.templateOrder[0]];
    const draft = createTemplateConfigDraft(template);
    const entryMember = draft.members.find((member) => member.isEntryMember);

    expect(entryMember).toBeDefined();
    if (!entryMember) {
      throw new Error("Expected an entry member");
    }

    const remainingMembers = removeTemplateMemberDraft(draft.members, entryMember.id);

    expect(remainingMembers).toHaveLength(draft.members.length - 1);
    expect(remainingMembers.filter((member) => member.isEntryMember)).toHaveLength(1);
  });

  it("builds template config payloads with newly added members", () => {
    const snapshot = createSeedWorkspace();
    const template = snapshot.templates[snapshot.templateOrder[0]];
    const draft = createTemplateConfigDraft(template);
    const nextMembers = addEmptyTemplateMemberDraft(draft.members, {
      templateAccentTone: draft.accentTone,
      baseMember: draft.members[0],
    });
    const addedMember = nextMembers.at(-1);

    if (!addedMember) {
      throw new Error("Expected an added member");
    }

    addedMember.name = "QA Reviewer";
    addedMember.handle = "qa-review";
    addedMember.summary = "Reviews changes before handoff.";
    addedMember.prompt = "Review changes, raise issues, and keep the room updated with short progress notes.";

    const payload = buildTemplateConfigInput(template, {
      ...draft,
      members: nextMembers,
    });

    expect(payload.members).toHaveLength(template.members.length + 1);
    expect(payload.members.at(-1)).toMatchObject({
      id: addedMember.id,
      name: "QA Reviewer",
      handle: "qa-review",
      summary: "Reviews changes before handoff.",
      prompt: "Review changes, raise issues, and keep the room updated with short progress notes.",
      provider: {
        command: draft.members[0]?.provider.command,
      },
    });
  });
});
