import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";
import babelMacros from "vite-plugin-babel-macros";

// The msg/t macros need the lingui plugin + babel-macros to transform at build
// time. The shared @carbon/config vitest preset doesn't include them (other
// packages don't use the macro in their own tests). We add them here so the
// drift test can import messages.ts and resolve `msg\`…\``.
export default defineConfig({
  plugins: [babelMacros(), lingui()],
  test: {
    globals: false,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "test/__fixtures__", ".turbo"]
  }
});
