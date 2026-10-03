import { defineConfig } from "vitest/config";

export default defineConfig({
  // The jSquash wasm codecs are loaded as `?inline` data URIs (see
  // packages/files/src/media/node.ts) — Vite only honours that query for a file
  // it treats as an asset, and `.wasm` is not one by default.
  assetsInclude: ["**/*.wasm"],
  test: {
    globals: false,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "test/__fixtures__", ".turbo"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/index.ts"],
    },
  },
});
