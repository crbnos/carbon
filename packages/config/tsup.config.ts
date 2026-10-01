// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["vitest.mts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  external: ["vitest", "vitest/config"],
});
