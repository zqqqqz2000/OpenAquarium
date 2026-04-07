import type { AcpProviderDescriptor } from "../types";
import { mergeCodexAcpEnv } from "./codex-session";

export const CODEX_ACP_NPX_COMMAND = "npx";
export const CODEX_ACP_PACKAGE_NAME = "@zed-industries/codex-acp";
export const CODEX_ACP_MIN_VERSION = "^0.11.1";
export const CODEX_ACP_MIN_VERSION_PACKAGE_SPEC = `${CODEX_ACP_PACKAGE_NAME}@${CODEX_ACP_MIN_VERSION}`;
export const CODEX_ACP_NPX_ARGS = [CODEX_ACP_MIN_VERSION_PACKAGE_SPEC];

export function isCodexAcpPackageSpec(value: string | undefined): boolean {
  return (
    value === CODEX_ACP_PACKAGE_NAME ||
    value?.startsWith(`${CODEX_ACP_PACKAGE_NAME}@`) === true
  );
}

export interface CodexAcpOptions {
  command?: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
}

export function createCodexAcpProvider(
  options: CodexAcpOptions = {},
): AcpProviderDescriptor {
  return {
    kind: "codex-acp",
    label: "Codex ACP",
    command: options.command ?? CODEX_ACP_NPX_COMMAND,
    args: options.args ?? CODEX_ACP_NPX_ARGS,
    env: mergeCodexAcpEnv(options.env),
    workingDirectory: options.workingDirectory,
    capabilities: ["prompt", "cancel", "loadSession"],
    supportsInterrupt: true,
  };
}
