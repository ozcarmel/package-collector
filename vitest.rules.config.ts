import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/rules/**/*.test.ts"],
    maxConcurrency: 1,
  },
});
