import path from "node:path";

import { createDiagnosticsLogger } from "./diagnostics";
import { startWorkspaceHttpServer } from "./http-server";
import { WorkspaceRuntime } from "./runtime";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const port = Number(process.env.OA_SERVER_PORT ?? "4301");
  const stateFilePath = process.env.OA_STATE_FILE ?? path.join(workspaceRoot, ".openaquarium", "state.json");
  const taskExecutionInactivityTimeoutMs = Number(process.env.OA_TASK_EXECUTION_INACTIVITY_TIMEOUT_MS ?? "300000");
  const taskExecutionMaxRetries = Number(process.env.OA_TASK_EXECUTION_MAX_RETRIES ?? "5");
  const logger = createDiagnosticsLogger({
    workspaceRoot,
  });
  const runtime = await WorkspaceRuntime.create({
    workspaceRoot,
    stateFilePath,
    taskExecutionInactivityTimeoutMs,
    taskExecutionMaxRetries,
    logger,
  });
  const server = await startWorkspaceHttpServer({
    runtime,
    port,
    logger,
  });
  let isShuttingDown = false;

  console.log(`OpenAquarium server listening on http://127.0.0.1:${port}`);
  logger.info("server-listening", {
    port,
    stateFilePath,
    taskExecutionInactivityTimeoutMs,
    taskExecutionMaxRetries,
  });

  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    try {
      await server.close();
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_SERVER_NOT_RUNNING") {
        throw error;
      }
    } finally {
      await runtime.dispose();
    }

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
