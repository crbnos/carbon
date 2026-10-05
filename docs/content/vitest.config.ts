// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

// The msg/t macros need the lingui plugin's macro transform at build
// time. The shared @carbon/config vitest preset doesn't include them (other
// packages don't use the macro in their own tests). We add them here so the
// drift test can import messages.ts and resolve `msg\`…\``.
export default defineConfig({
  plugins: [lingui({ macroTransform: true })],
  test: {
    globals: false,
    environment: "node",
    passWithNoTests: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "test/__fixtures__", ".turbo"]
  }
});
