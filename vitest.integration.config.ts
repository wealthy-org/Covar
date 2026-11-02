import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/features/strategies/__tests__/*.integration.test.ts",
    ],
    environment: "node",
    setupFiles: ["dotenv/config"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});