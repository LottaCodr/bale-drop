import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests cover the parts of the app where a bug costs money or trust:
 * cart math, store persistence/sanitisation, search filtering and URL state.
 * (Docs: docs/ROADMAP.md — "Testing" section explains the scope choice.)
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["lib/__tests__/test-setup.ts"],
    reporters: "dot",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@bale-drop/database": fileURLToPath(new URL("../../packages/database/src/index.ts", import.meta.url)),
    },
  },
});
