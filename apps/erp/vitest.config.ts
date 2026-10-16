// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { linguiWithoutIdQuery } from "@carbon/dev/vite";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compile Lingui macros as the app does, so a module that defines its
  // messages with `msg` can be imported by a test without stubbing the macro.
  plugins: [linguiWithoutIdQuery(lingui({ macroTransform: true }))],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "test/**/*.test.ts"],
    passWithNoTests: true,
    // @carbon/env throws at import time when these are unset; tests that
    // transitively import a module barrel (e.g. modules/shared) hit it.
    // Stub values that satisfy "is set" without enabling any side-effects.
    env: {
      INNGEST_SIGNING_KEY: "test",
      INNGEST_EVENT_KEY: "test",
      SUPABASE_URL: "http://localhost",
      SUPABASE_ANON_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "test",
      SUPABASE_API_URL: "http://localhost",
      SUPABASE_DB_URL: "postgresql://localhost",
      SESSION_SECRET: "test",
      REDIS_URL: "redis://localhost"
    }
  }
});
