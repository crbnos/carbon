// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { lingui } from "@lingui/vite-plugin";
import babelMacros from "vite-plugin-babel-macros";
import { defineConfig } from "vitest/config";

/**
 * The tool sweep runs the REAL services against a running local stack, so it
 * needs that stack's real environment — unlike the unit tests, whose config
 * stubs every variable. By default that is this app's own `.env` then
 * `.env.local` (what `crbn up` wrote). `CARBON_SWEEP_ENV` names other files, in
 * order (later wins), to sweep a stack another checkout is running:
 * `<checkout>/.env:<checkout>/.env.local`.
 */
function readEnvFiles(spec: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const files = spec
    ? spec.split(":").filter(Boolean)
    : [".env", ".env.local"].filter((file) => existsSync(file));
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      env[match[1]] = match[2]
        .replace(/\s+#force\s*$/, "")
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return env;
}

export default defineConfig({
  // The services import the glossary, whose strings are Lingui macros: without
  // the app's own transform `msg` is not a function.
  plugins: [babelMacros(), lingui()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["test/sweep/**/*.sweep.ts"],
    env: readEnvFiles(process.env.CARBON_SWEEP_ENV),
    testTimeout: 600_000,
    hookTimeout: 120_000,
    // One process, in order: the sweep shares one database connection pool.
    fileParallelism: false
  }
});
