import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "test/**/*.test.ts"],
    passWithNoTests: true
  }
});
