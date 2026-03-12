import { vi } from "vitest";

vi.mock("@streamdown/code", () => ({
  code: {
    name: "shiki",
    type: "code-highlighter",
    getSupportedLanguages: () => [],
    getThemes: () => ["github-light", "github-dark"] as const,
    highlight: () => null,
    supportsLanguage: () => false,
  },
}));

vi.mock("@streamdown/mermaid", () => ({
  mermaid: {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: () => ({
      initialize: () => undefined,
      render: async () => ({ svg: "<svg></svg>" }),
    }),
  },
}));
