// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "vite";

/**
 * Merge `.env*` files into `process.env` so SSR code that reads `process.env`
 * (e.g. `@carbon/auth`, `@carbon/env`) sees the same values as Vite's
 * `import.meta.env`.
 *
 * App-local files are loaded first, then repo-root files (last wins) so
 * `crbn up`–written root `.env.local` overrides stale app-level copies.
 *
 * In non-production modes, file values **overwrite** existing `process.env`
 * keys — `react-router dev` can invoke the vite config with modes other than
 * `"development"` during startup, which previously left stale shell values
 * (e.g. `SUPABASE_URL=127.0.0.1:54321`) in place.
 */
export function applyDotenvToProcessEnv(mode, appDir) {
  const repoRoot = path.resolve(appDir, "../..");
  const fromFiles = {
    ...loadEnv(mode, appDir, ""),
    ...loadEnv(mode, repoRoot, ""),
  };
  const devOverwrite = mode !== "production";
  for (const [key, value] of Object.entries(fromFiles)) {
    if (value === undefined || value === "") continue;
    if (devOverwrite || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Resolve `specifier` to `file` in the browser build only. A top-level
 * `resolve.alias` applies to every environment, so a stub meant to keep a
 * chunk out of the client bundle also replaces the module on the server.
 *
 * @param {string} specifier
 * @param {string} file
 * @returns {import("vite").Plugin}
 */
export function clientOnlyAlias(specifier, file) {
  return {
    name: `carbon:client-only-alias:${specifier}`,
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "client",
    resolveId(source) {
      if (source === specifier) return file;
    },
  };
}

/**
 * `@lingui/vite-plugin` 6.9.0 infers the parser from `path.basename(id)`, so a
 * React Router route module (`route.tsx?__react-router-build-client-route`)
 * is parsed as plain JS and fails on its first `import type`. Hand the macro
 * transform the id without its query. Remove once Lingui strips it upstream.
 *
 * @param {import("vite").Plugin[]} plugins the array `lingui()` returns
 * @returns {import("vite").Plugin[]}
 */
export function linguiWithoutIdQuery(plugins) {
  const name = "vite-plugin-lingui-macro-transform";
  if (!plugins.some((plugin) => plugin.name === name)) {
    throw new Error(
      `linguiWithoutIdQuery: no "${name}" plugin. Pass lingui({ macroTransform: true }); if Lingui renamed it, update or delete this wrapper.`
    );
  }
  return plugins.map((plugin) => {
    if (plugin.name !== name) return plugin;
    const { handler } = plugin.transform;
    return {
      ...plugin,
      transform: {
        ...plugin.transform,
        handler(code, id) {
          return handler.call(this, code, id.split("?")[0]);
        },
      },
    };
  });
}

/**
 * Dev-server half of stack hibernation (see `services/hibernate.ts` in this
 * package). Touches `activity` on each request so `crbn up` can tell the apps
 * are in use, and holds a request while the stack is asleep until `crbn up`
 * has started the containers again. Does nothing unless `crbn up` set
 * `CRBN_STACK_STATE`, so a build or a bare `vite dev` is unaffected.
 *
 * `/api/inngest` is not traffic: the Inngest dev server polls it constantly
 * and would keep every stack awake.
 *
 * @returns {import("vite").Plugin}
 */
export function stackActivity() {
  return {
    name: "carbon:stack-activity",
    apply: "serve",
    configureServer(server) {
      const dir = process.env.CRBN_STACK_STATE;
      if (!dir) return;
      const activity = path.join(dir, "activity");
      const asleep = path.join(dir, "asleep");
      let touched = 0;
      const touch = (force) => {
        const now = Date.now();
        if (!force && now - touched < 2000) return;
        touched = now;
        try {
          fs.writeFileSync(activity, "");
        } catch {
          // crbn up is gone; nothing is watching
        }
      };
      server.middlewares.use(async (req, _res, next) => {
        if (req.url?.startsWith("/api/inngest")) return next();
        touch(false);
        if (fs.existsSync(asleep)) {
          touch(true);
          const deadline = Date.now() + 120_000;
          while (fs.existsSync(asleep) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        next();
      });
    },
  };
}
