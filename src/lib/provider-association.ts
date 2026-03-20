import type { ProviderBinding } from "@/domain/model";

export const PROVIDER_ASSOCIATION_REQUIRED_ENV_KEY =
  "OPENAQUARIUM_PROVIDER_ASSOCIATION_REQUIRED";

export function isProviderAssociationRequiredBinding(
  provider: Pick<ProviderBinding, "env">,
): boolean {
  return provider.env[PROVIDER_ASSOCIATION_REQUIRED_ENV_KEY] === "1";
}

export function createProviderAssociationRequiredBinding(
  label = "Provider association required",
): ProviderBinding {
  return {
    kind: "generic-acp",
    label,
    command: "",
    args: [],
    env: {
      [PROVIDER_ASSOCIATION_REQUIRED_ENV_KEY]: "1",
    },
    capabilities: [],
  };
}
