import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.spec.ts"],
    globals: false,
    restoreMocks: true,
    fileParallelism: false,
    setupFiles: ["src/integration-test-setup.ts"],
    hookTimeout: 30000,
  },
});
