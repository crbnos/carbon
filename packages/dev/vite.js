// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import fs from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
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

/**
 * Compresses the client build once, at build time, and keeps only the
 * result: each asset becomes a `.br` at Brotli's highest setting and the
 * original is removed. `@carbon/serve` sends the `.br` as it is, where the
 * stock server compressed the same never-changing file again on every
 * request, at a setting weak enough to do that fast.
 *
 * Every production build does this except Vercel's: Vercel serves the
 * files from its own CDN, compresses them there, and would have nothing to
 * send once the originals were gone. Client build only: nobody downloads
 * the server bundle.
 *
 * The plugin is native code, imported only when it is going to run, so
 * `vite dev` never loads it.
 *
 * @param {{ command: "build" | "serve", mode: string }} env what Vite
 *   hands a config function
 * @returns {Promise<import("vite").Plugin[]>}
 */
export async function precompressedAssets({ command, mode }) {
  if (command !== "build" || mode !== "production" || process.env.VERCEL) {
    return [];
  }
  const { compression, defineAlgorithm } = await import(
    "@medicomind/rolldown-compression"
  );
  /** @type {string | undefined} */
  let clientDirectory;
  return [
    {
      ...compression({
        // Under this a response is one packet either way.
        threshold: 1024,
        algorithms: [defineAlgorithm("brotli", { quality: 11 })],
        // From disk, after everything is written. In memory the plugin
        // sees each chunk before Vite has finished it — the preload lists
        // are still `__VITE_PRELOAD__` — and the `.br` it wrote was of code
        // that throws the first time it lazy-loads anything.
        stream: true,
      }),
      applyToEnvironment: (environment) => environment.name === "client",
    },
    {
      // The originals go last, once the server build is done. The plugin's
      // own `deleteOriginalAssets` takes them out of the bundle while React
      // Router still reads it, and the build fails on "Chunk not found".
      name: "carbon:keep-compressed-only",
      applyToEnvironment: (environment) => environment.name === "ssr",
      configResolved(config) {
        const outDir = config.environments?.client?.build?.outDir;
        if (outDir) clientDirectory = path.resolve(config.root, outDir);
      },
      closeBundle: {
        order: "post",
        sequential: true,
        async handler(error) {
          if (error || !clientDirectory) return;
          // React Router writes its route manifest after the client
          // build's plugins have run, so the largest script in the build
          // was the one file left without a `.br`.
          await compressRemaining(clientDirectory);
          const removed = await removeCompressedOriginals(clientDirectory);
          this.info(`kept only the Brotli copy of ${removed} client asset(s)`);
        },
      },
    },
  ];
}

/** @param {Buffer} source */
const brotli = (source) =>
  promisify(brotliCompress)(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });

/**
 * Writes a `.br` beside every script and stylesheet under `directory` that
 * is worth compressing and has none.
 *
 * @param {string} directory
 */
export async function compressRemaining(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = new Set(entries.map((e) => path.join(e.parentPath, e.name)));
  for (const file of files) {
    if (!/\.(js|css)$/.test(file) || files.has(`${file}.br`)) continue;
    const source = await readFile(file);
    if (source.length < 1024) continue;
    await writeFile(`${file}.br`, await brotli(source));
  }
}

/**
 * Deletes every file under `directory` that has a `.br` beside it.
 *
 * @param {string} directory
 * @returns {Promise<number>} how many were removed
 */
export async function removeCompressedOriginals(directory) {
  let removed = 0;
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".br")) continue;
    const original = path.join(entry.parentPath, entry.name.slice(0, -3));
    try {
      await unlink(original);
      removed++;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return removed;
}
