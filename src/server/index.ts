import path from "node:path";

import { startWorkspaceHttpServer } from "./http-server";
import { WorkspaceRuntime } from "./runtime";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const port = Number(process.env.OA_SERVER_PORT ?? "4301");
  const stateFilePath = process.env.OA_STATE_FILE ?? path.join(workspaceRoot, ".openaquarium", "state.json");
  const runtime = await WorkspaceRuntime.create({
    workspaceRoot,
    stateFilePath,
  });
  const server = await startWorkspaceHttpServer({
    runtime,
    port,
  });

  console.log(`OpenAquarium server listening on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    await runtime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
