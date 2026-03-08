import type { AcpProviderDescriptor } from "../types";

export const CODEX_ACP_NPX_COMMAND = "npx";
export const CODEX_ACP_NPX_ARGS = ["@zed-industries/codex-acp"];

export interface CodexAcpOptions {
  command?: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
}

export function createCodexAcpProvider(options: CodexAcpOptions = {}): AcpProviderDescriptor {
  return {
    kind: "codex-acp",
    label: "Codex ACP",
    command: options.command ?? CODEX_ACP_NPX_COMMAND,
    args: options.args ?? CODEX_ACP_NPX_ARGS,
    env: options.env ?? {},
    workingDirectory: options.workingDirectory,
    capabilities: ["prompt", "cancel", "loadSession"],
    supportsInterrupt: true,
  };
}
