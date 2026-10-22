/// <reference types="vitest" />
// Separate config so the existing vitest.config.mts (src unit tests) is untouched.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"],
    setupFiles: ["tests/integration/setup.ts"],
    globals: true,
    testTimeout: 15000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
