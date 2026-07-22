import { lingui } from "@lingui/vite-plugin";
import babelMacros from "vite-plugin-babel-macros";
import { defineConfig } from "vitest/config";

// The msg macro needs the lingui plugin + babel-macros to transform at build
// time (the shared @carbon/config vitest preset doesn't include them). Added so
// the tailoring tests can import content files that use `msg`. Same shape as
// packages/glossary/vitest.config.ts.
export default defineConfig({
  plugins: [babelMacros(), lingui()],
  test: {
    globals: false,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".turbo"]
  }
});
