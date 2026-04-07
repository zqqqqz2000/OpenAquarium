import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const normalizedRootDir = rootDir.split(path.sep).join("/");
import react from "@vitejs/plugin-react";

const enableReactCompiler = process.env.OA_ENABLE_REACT_COMPILER !== "0";
const enableReactPlugin = process.env.OA_ENABLE_VITE_REACT_PLUGIN !== "0";
const enableTailwindPlugin = process.env.OA_ENABLE_VITE_TAILWIND_PLUGIN !== "0";
const ignoredRuntimeArtifactDirectories = new Set([
  ".codex-output",
  ".oa-tmp",
  ".openaquarium",
  ".playwright-cli",
  ".playwright-mcp",
  ".tmp",
  "dogfood-output",
  "output",
  "test-results",
]);
const ignoredRootArtifactExtensions = new Set([".jpeg", ".jpg", ".log", ".png"]);

function normalizeWatchPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function toWorkspaceRelativePath(filePath) {
  const normalizedPath = normalizeWatchPath(filePath);

  if (normalizedPath.startsWith(`${normalizedRootDir}/`)) {
    return normalizedPath.slice(normalizedRootDir.length + 1);
  }

  return normalizedPath.replace(/^\.\//, "");
}

function isRuntimeArtifactPath(filePath) {
  const relativePath = toWorkspaceRelativePath(filePath);
  const [firstSegment] = relativePath.split("/");

  if (!firstSegment) {
    return false;
  }

  if (ignoredRuntimeArtifactDirectories.has(firstSegment) || firstSegment.startsWith("tmp-")) {
    return true;
  }

  return !relativePath.includes("/") && ignoredRootArtifactExtensions.has(path.posix.extname(relativePath));
}

export default defineConfig({
  plugins: [
    ...(enableReactPlugin
      ? [
          react(enableReactCompiler
            ? {
                babel: {
                  plugins: [["babel-plugin-react-compiler", { target: "19" }]],
                },
              }
            : undefined),
        ]
      : []),
    ...(enableTailwindPlugin ? [tailwindcss()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  server: {
    watch: {
      ignored: isRuntimeArtifactPath,
    },
  },
});
