import type { AcpProviderDescriptor } from "../types";

export interface GenericAcpOptions {
  label: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
  capabilities?: string[];
  supportsInterrupt?: boolean;
}

export function createGenericAcpProvider(options: GenericAcpOptions): AcpProviderDescriptor {
  return {
    kind: "generic-acp",
    label: options.label,
    command: options.command,
    args: options.args ?? [],
    env: options.env ?? {},
    workingDirectory: options.workingDirectory,
    capabilities: options.capabilities ?? ["prompt", "cancel"],
    supportsInterrupt: options.supportsInterrupt ?? true,
  };
}
