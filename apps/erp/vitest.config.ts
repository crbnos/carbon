// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { linguiWithoutIdQuery } from "@carbon/dev/vite";
import { lingui } from "@lingui/vite-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function moduleMacrosOnly(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => {
    const transform = plugin.transform;
    if (!transform) return plugin;
    const handler = typeof transform === "function" ? transform : transform.handler;
    const skippingComponents: typeof handler = function (code, id, options) {
      if (/\.tsx(\?|$)/.test(id)) return null;
      return handler.call(this, code, id, options);
    };
    // Keep the plugin's own hook filter: without it the transform runs on
    // every file, JSON and compiled classes included.
    return {
      ...plugin,
      transform:
        typeof transform === "function"
          ? skippingComponents
          : { ...transform, handler: skippingComponents }
    };
  });
}

export default defineConfig({
  // Compile Lingui macros in .ts modules as the app does, so a service that
  // reads a `msg` table can be imported without stubbing the macro. Components
  // (.tsx) keep their tests' own `@lingui/react/macro` mocks: compiled, the
  // hooks would need an I18nProvider no component test renders.
  plugins: [moduleMacrosOnly(linguiWithoutIdQuery(lingui({ macroTransform: true })))],
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
      // A real local database URL from the environment runs the database
      // tests (test/database); the stub is not a local host, so they skip.
      SUPABASE_DB_URL:
        process.env.SUPABASE_DB_URL ?? "postgresql://stub.invalid/postgres",
      SESSION_SECRET: "test",
      REDIS_URL: "redis://localhost"
    }
  }
});
