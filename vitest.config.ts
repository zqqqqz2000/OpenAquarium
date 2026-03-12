import { fileURLToPath } from "node:url";
import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    pool: "forks",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, ".codex-output/**", "dogfood-output/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/domain/**/*.ts", "src/store/**/*.ts", "src/lib/acp/**/*.ts"],
    },
  },
});
