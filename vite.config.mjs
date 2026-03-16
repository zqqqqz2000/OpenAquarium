import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
import react from "@vitejs/plugin-react";

const enableReactCompiler = process.env.OA_ENABLE_REACT_COMPILER !== "0";
const enableReactPlugin = process.env.OA_ENABLE_VITE_REACT_PLUGIN !== "0";
const enableTailwindPlugin = process.env.OA_ENABLE_VITE_TAILWIND_PLUGIN !== "0";

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
});
