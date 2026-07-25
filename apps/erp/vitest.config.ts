import { lingui } from "@lingui/vite-plugin";
import babelMacros from "vite-plugin-babel-macros";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Some util/service modules transitively import the @carbon/auth barrel, which
  // pulls @carbon/glossary's Lingui `msg` macro. Transform macros so those
  // modules can be imported (and unit-tested) under vitest.
  plugins: [babelMacros(), lingui()],
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
