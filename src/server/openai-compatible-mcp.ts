import path from "node:path";

import type { Tool } from "@ai-sdk/provider-utils";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

import type {
  OpenAICompatibleMCPServer,
  OpenAICompatibleProviderBinding,
} from "../domain/model";

function resolveServerCwd(defaultWorkingDirectory: string, cwd?: string): string | undefined {
  const normalized = cwd?.trim();
  if (!normalized) {
    return undefined;
  }

  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(defaultWorkingDirectory, normalized);
}

async function createServerClient(args: {
  server: OpenAICompatibleMCPServer;
  defaultWorkingDirectory: string;
}): Promise<MCPClient> {
  const { server } = args;
  if (server.transport === "stdio") {
    return createMCPClient({
      name: `openaquarium-${server.id}`,
      transport: new Experimental_StdioMCPTransport({
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: resolveServerCwd(args.defaultWorkingDirectory, server.cwd),
      }),
    });
  }

  return createMCPClient({
    name: `openaquarium-${server.id}`,
    transport: {
      type: server.transport,
      url: server.url,
      headers: server.headers,
    },
  });
}

async function closeClients(clients: MCPClient[]): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()));
}

export async function createConfiguredMcpTools(args: {
  binding: OpenAICompatibleProviderBinding;
  defaultWorkingDirectory: string;
}): Promise<{
  tools: Record<string, Tool>;
  close(): Promise<void>;
}> {
  if (args.binding.mcpServers.length === 0) {
    return {
      tools: {},
      close: () => Promise.resolve(),
    };
  }

  const clients: MCPClient[] = [];
  const tools: Record<string, Tool> = {};
  const seenToolOwners = new Map<string, string>();

  try {
    for (const server of args.binding.mcpServers) {
      const client = await createServerClient({
        server,
        defaultWorkingDirectory: args.defaultWorkingDirectory,
      });
      clients.push(client);

      const serverTools = await client.tools();
      for (const [toolName, toolDefinition] of Object.entries(serverTools)) {
        const previousOwner = seenToolOwners.get(toolName);
        if (previousOwner) {
          throw new Error(`Duplicate MCP tool name "${toolName}" configured by servers "${previousOwner}" and "${server.id}"`);
        }
        seenToolOwners.set(toolName, server.id);
        tools[toolName] = toolDefinition;
      }
    }

    return {
      tools,
      close: async () => closeClients(clients),
    };
  } catch (error) {
    await closeClients(clients);
    throw error;
  }
}
