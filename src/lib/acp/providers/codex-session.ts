import type { NewSessionResponse } from "@agentclientprotocol/sdk";
import type { ACPProvider } from "@mcpc-tech/acp-ai-provider";

export const CODEX_ACP_MODE_ENV_KEY = "OA_CODEX_ACP_MODE";
export const CODEX_ACP_SUPPORTED_MODES = ["read-only", "auto", "full-access"] as const;
export const CODEX_ACP_DEFAULT_MODE = "full-access";

export type CodexAcpMode = (typeof CODEX_ACP_SUPPORTED_MODES)[number];

export interface CodexSessionModeController {
  initSession(tools?: Parameters<ACPProvider["initSession"]>[0]): Promise<NewSessionResponse>;
  setMode(modeId: string): Promise<void>;
}

export function mergeCodexAcpEnv(env: Record<string, string> = {}): Record<string, string> {
  return {
    [CODEX_ACP_MODE_ENV_KEY]: CODEX_ACP_DEFAULT_MODE,
    ...env,
  };
}

export function resolveCodexAcpMode(rawMode: string | undefined): CodexAcpMode {
  const normalizedMode = rawMode?.trim();

  if (normalizedMode && CODEX_ACP_SUPPORTED_MODES.includes(normalizedMode as CodexAcpMode)) {
    return normalizedMode as CodexAcpMode;
  }

  return CODEX_ACP_DEFAULT_MODE;
}

export async function ensureCodexAcpSessionMode(
  provider: CodexSessionModeController,
  options: {
    mode?: string;
    tools?: Parameters<ACPProvider["initSession"]>[0];
  } = {},
): Promise<NewSessionResponse> {
  const session = await provider.initSession(options.tools);
  const desiredMode = resolveCodexAcpMode(options.mode);
  const availableModes = session.modes?.availableModes?.map((mode) => mode.id) ?? [];

  if (availableModes.length > 0 && !availableModes.includes(desiredMode)) {
    throw new Error(`Codex ACP session mode "${desiredMode}" is unavailable. Available modes: ${availableModes.join(", ")}`);
  }

  if (session.modes?.currentModeId === desiredMode) {
    return session;
  }

  await provider.setMode(desiredMode);
  return session;
}
