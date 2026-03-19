import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { OpenAICompatibleProviderBinding } from "../domain/model";

export function resolveOpenAICompatibleApiKey(
  binding: Pick<OpenAICompatibleProviderBinding, "apiKeyEnvVar">,
): string | undefined {
  const envVarName = binding.apiKeyEnvVar?.trim();
  if (!envVarName) {
    return undefined;
  }

  return process.env[envVarName]?.trim() || undefined;
}

export function buildOpenAICompatibleRequestHeaders(
  binding: Pick<OpenAICompatibleProviderBinding, "apiKeyEnvVar" | "headers">,
): Record<string, string> {
  const apiKey = resolveOpenAICompatibleApiKey(binding);
  return {
    ...binding.headers,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function buildOpenAICompatibleUrl(baseURL: string, pathname: string): string {
  const normalizedBaseUrl = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  return new URL(pathname.replace(/^\//u, ""), normalizedBaseUrl).toString();
}

export function createOpenAICompatibleProvider(
  binding: Pick<
    OpenAICompatibleProviderBinding,
    "label" | "baseURL" | "apiKeyEnvVar" | "headers" | "extraBody"
  >,
): ReturnType<typeof createOpenAICompatible> {
  return createOpenAICompatible({
    name: binding.label,
    baseURL: binding.baseURL,
    apiKey: resolveOpenAICompatibleApiKey(binding),
    headers: binding.headers,
    transformRequestBody: (body) => ({
      ...body,
      ...binding.extraBody,
    }),
  });
}
