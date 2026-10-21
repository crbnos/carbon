// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import fs from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
  const exact = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    name: `carbon:client-only-alias:${specifier}`,
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "client",
    resolveId: {
      // Matched natively: no JS call for any other import.
      filter: { id: new RegExp(`^${exact}$`) },
      handler: (source) => (source === specifier ? file : undefined),
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
    // Its middleware has to see a request before any app handler does.
    enforce: "pre",
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
 * Compresses the client build once, at build time: a `.br` at Brotli's
 * highest setting is written beside each asset. `@carbon/serve` sends the
 * `.br` as it is, where the stock server compressed the same never-changing
 * file again on every request, at a setting weak enough to do that fast.
 * The originals stay, for a caller that does not take Brotli and for
 * anything else that reads the build.
 *
 * Every production build does this except Vercel's: Vercel serves the
 * files from its own CDN and compresses them there, and never asks for a
 * `.br`. Client build only: nobody downloads the server bundle.
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
      // React Router writes its route manifest after the client build's
      // plugins have run, so the largest script in the build was the one
      // file left without a `.br`. Once the server build is done, it is
      // there to compress.
      name: "carbon:compress-remaining",
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
          await compressRemaining(clientDirectory);
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
 * Splits a production server build into one chunk per installed package
 * (`vendor-<name>`) and per workspace package (`carbon-<name>`), instead of
 * one file holding every dependency. Vercel traces the server function with
 * @vercel/nft after the build, and nft handles one huge module far worse than
 * many small ones: the ERP's 35 MB single bundle took ~5 min there and up to
 * the full 8 GB of a build machine; split, the step takes under a minute.
 * Applied to every SSR environment, including the Vercel preset's
 * `ssrBundle_*`, through `configEnvironment`, so it merges over React
 * Router's own entry.
 *
 * Only modules the server loads at startup (reached from the entry by static
 * imports) are grouped. A package chunk holding a module that is only reached
 * through `import()` would load it eagerly: the browser-only query devtools
 * did, and threw on `window`. A cycle reads as lazy, which only leaves that
 * module where Rolldown would put it.
 *
 * @returns {import("vite").Plugin}
 */
export function splitServerByPackage() {
  /** @param {string} id */
  const packageChunk = (id) => {
    if (!id.includes("node_modules/")) {
      return `carbon-${id.split("/packages/").pop()?.split("/")[0]}`;
    }
    const [scope, name] = (id.split("node_modules/").pop() ?? "").split("/");
    return `vendor-${scope.startsWith("@") ? `${scope}+${name}` : scope}`;
  };
  return {
    name: "carbon:split-server-by-package",
    apply: "build",
    configEnvironment(name) {
      if (!name.startsWith("ssr")) return;
      /** @type {Map<string, boolean>} */
      const eager = new Map();
      /**
       * @param {string} id
       * @param {import("vite").Rolldown.ChunkingContext} ctx
       * @returns {boolean}
       */
      const loadsAtStartup = (id, ctx) => {
        const known = eager.get(id);
        if (known !== undefined) return known;
        eager.set(id, false);
        const info = ctx.getModuleInfo(id);
        const result =
          !!info &&
          (info.isEntry ||
            info.importers.some((importer) => loadsAtStartup(importer, ctx)));
        eager.set(id, result);
        return result;
      };
      return {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: (id, ctx) =>
                      loadsAtStartup(id, ctx) ? packageChunk(id) : null,
                    // Matched natively before the name callback runs.
                    test: /node_modules|\/packages\//,
                  },
                ],
              },
            },
          },
        },
      };
    },
  };
}

/**
 * Every Carbon app's own Vite plugins, in one call. React Router and
 * Tailwind stay in the app's config, as the framework and styling plugins.
 *
 * Always on: stack activity (a no-op outside `crbn up`) and Lingui's macro
 * transform with the React Router id fix. The rest is opt-in, and a package
 * is imported only when its plugin runs, so a dev server or a small app pays
 * nothing for what it does not use.
 *
 * @param {import("./vite").CarbonOptions} options
 * @returns {Promise<import("vite").PluginOption[]>}
 */
export async function carbon({
  command,
  mode,
  locales = false,
  clientOnly = {},
  splitServer = false,
  precompress = false,
} = {}) {
  const { lingui } = await import("@lingui/vite-plugin");
  return [
    stackActivity(),
    linguiWithoutIdQuery(lingui({ macroTransform: true })),
    splitServer && splitServerByPackage(),
    precompress && command && mode && precompressedAssets({ command, mode }),
    locales && ariaLocales(),
    ...Object.entries(clientOnly).map(([specifier, file]) =>
      clientOnlyAlias(specifier, file)
    ),
  ].filter(Boolean);
}

// react-aria ships strings for ~34 locales; keep the ones the app translates.
async function ariaLocales() {
  const [{ getConfig }, { default: optimizeLocales }] = await Promise.all([
    import("@lingui/conf"),
    import("@react-aria/optimize-locales-plugin"),
  ]);
  return optimizeLocales.vite({ locales: getConfig().locales });
}
