// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import fs from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import { loadEnv, normalizePath } from "vite";
import {
  activityFile,
  BOOT_TIMEOUT_MS,
  isAsleepIn,
  isBootingIn,
  isCloudDev,
  STACK_STATE_ENV,
  WAKE_TIMEOUT_MS
} from "./stack-state.js";

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
 * `"development"` during startup, and a stale shell value
 * (e.g. `SUPABASE_URL=127.0.0.1:54321`) would otherwise stay in place.
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

/** Waits while `held()` is true; false when it still is at the deadline. */
async function waitWhile(held, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (held()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return true;
}

/**
 * Cloud container only (scripts/cloud-dev.sh): transform the app's `warmup`
 * files when the server starts, not at the first request, which otherwise
 * waits about two minutes on a 4-core box; and allow any host, since the
 * session reaches the server through a forwarded port.
 *
 * @param {import("./vite").CarbonOptions["cloudWarmup"]} warmup
 * @returns {import("vite").Plugin}
 */
function cloudDevServer(warmup) {
  return {
    name: "carbon:cloud-dev-server",
    apply: "serve",
    config(config) {
      if (!isCloudDev()) return;
      // Set, not returned: Vite would concatenate `true` onto the app's list.
      config.server ??= {};
      config.server.allowedHosts = true;
      if (warmup) config.server.warmup = warmup;
    },
  };
}

/**
 * Dev-server half of stack hibernation (see `services/hibernate.ts` in this
 * package). Touches `activity` on each request so `crbn up` can tell the apps
 * are in use, and holds a request while the stack is asleep until `crbn up`
 * has started the containers again, or a cloud boot has the database ready.
 * Does nothing unless `crbn up` set
 * `CRBN_STACK_STATE`, so a build or a bare `vite dev` is unaffected.
 *
 * `/api/inngest` is not traffic: the Inngest dev server polls it constantly
 * and would keep every stack awake.
 *
 * @returns {import("vite").Plugin}
 */
function stackActivity() {
  return {
    name: "carbon:stack-activity",
    apply: "serve",
    // Its middleware has to see a request before any app handler does.
    enforce: "pre",
    configureServer(server) {
      const dir = process.env[STACK_STATE_ENV];
      if (!dir) return;
      const activity = activityFile(dir);
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
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/api/inngest")) return next();
        touch(false);
        if (isAsleepIn(dir)) {
          touch(true);
          await waitWhile(() => isAsleepIn(dir), WAKE_TIMEOUT_MS);
        }
        // A cloud boot starts the dev servers while it still migrates and
        // seeds; a request let through earlier would reach a half-built schema.
        if (!(await waitWhile(() => isBootingIn(dir), BOOT_TIMEOUT_MS))) {
          res.statusCode = 503;
          res.setHeader("Retry-After", "5");
          res.end("The database is still starting. Retry shortly.");
          return;
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
async function precompressedAssets({ command, mode }) {
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
async function compressRemaining(directory) {
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
function splitServerByPackage() {
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

const ICON_SET_IMPORT =
  /(import\s*\{([^}]*)\}\s*from\s*)(["'])react-icons\/([a-z0-9]+)\3/g;
const ICON_MODULE_PREFIX = "carbon-icons:";

/**
 * The icons each `import { … } from "react-icons/<set>"` in `code` names, by
 * set. Type-only imports (`import type { … }`, `type X`) and `react-icons/lib`
 * (the package's runtime, not a set) are not icon imports.
 *
 * @param {string} code
 * @returns {Map<string, Set<string>>}
 */
export function findIconImports(code) {
  /** @type {Map<string, Set<string>>} */
  const found = new Map();
  for (const [, , clause, , set] of code.matchAll(ICON_SET_IMPORT)) {
    if (set === "lib") continue;
    const names = clause
      // A comment inside the braces is not part of any name.
      // One pass, so a `/*` inside a line comment is not taken as a block.
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "")
      .split(",")
      .map((specifier) => specifier.trim())
      .filter((specifier) => specifier && !specifier.startsWith("type "))
      .map((specifier) => specifier.split(/\s+as\s+/)[0].trim());
    if (names.length === 0) continue;
    const set_ = found.get(set) ?? new Set();
    for (const name of names) set_.add(name);
    found.set(set, set_);
  }
  return found;
}

/**
 * Points each icon import in `code` at `carbon-icons:<set>:<version>`, the
 * module `version(set)` names. Only the specifier changes, so line and column
 * positions outside it stay put.
 *
 * @param {string} code
 * @param {(set: string) => string} version
 * @returns {string | null} the rewritten code, or null when nothing matched
 */
export function rewriteIconImports(code, version) {
  let changed = false;
  const next = code.replace(
    ICON_SET_IMPORT,
    (match, head, _clause, quote, set) => {
      if (findIconImports(match).size === 0) return match;
      changed = true;
      return `${head}${quote}${ICON_MODULE_PREFIX}${set}:${version(set)}${quote}`;
    }
  );
  return changed ? next : null;
}

/**
 * The source of a module exporting `names` from one react-icons set, cut out
 * of the set's generated `index.mjs`. Every icon there is one self-contained
 * `export function Name (props) { return GenIcon({…})(props); };` that needs
 * nothing but `GenIcon`, so the copy is the same component drawing the same
 * SVG. An icon the set has in some other form is re-exported from the set
 * itself, so an unexpected file costs speed, never correctness. A name the
 * set does not have is left out: the file importing it fails on its own, as
 * it would importing the set, rather than taking down every importer of the
 * module.
 *
 * @param {string} setSource the set's `index.mjs`
 * @param {string} set the set's directory name (`lu`, `pi`, …)
 * @param {Iterable<string>} names
 * @returns {string}
 */
export function extractIcons(setSource, set, names) {
  const icons = new Map();
  for (const chunk of setSource.split("\nexport function ").slice(1)) {
    const name = chunk.slice(0, chunk.indexOf(" "));
    icons.set(name, `export function ${chunk.trimEnd()}`);
  }
  const shape =
    /^export function \w+ \(props\) \{\n {2}return GenIcon\(.*\)\(props\);\n\};$/s;
  const found = [];
  const missing = [];
  for (const name of names) {
    const source = icons.get(name);
    if (source === undefined) continue;
    if (shape.test(source)) found.push(source);
    else missing.push(name);
  }
  return [
    'import { GenIcon } from "react-icons/lib";',
    ...found,
    missing.length > 0 &&
      `export { ${missing.join(", ")} } from "react-icons/${set}";`,
    "",
  ]
    .filter((line) => line !== false)
    .join("\n");
}

/**
 * The repository root (the directory holding `pnpm-workspace.yaml`) above
 * `directory`, or `directory` itself when there is none.
 *
 * @param {string} directory
 */
function workspaceRoot(directory) {
  for (let dir = directory; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (path.dirname(dir) === dir) return directory;
  }
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build"]);

/**
 * Every icon the source under `directories` imports, by set.
 *
 * @param {string[]} directories
 * @returns {Map<string, Set<string>>}
 */
function scanIconImports(directories) {
  /** @type {Map<string, Set<string>>} */
  const used = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const code = fs.readFileSync(file, "utf8");
        if (!code.includes("react-icons/")) continue;
        for (const [set, names] of findIconImports(code)) {
          const all = used.get(set) ?? new Set();
          for (const name of names) all.add(name);
          used.set(set, all);
        }
      }
    }
  };
  for (const directory of directories) walk(directory);
  return used;
}

/**
 * Dev-server only: serves react-icons the way a production build does, with
 * only the icons the code uses. Each icon set is one generated file of up to
 * 9,000 icons (5.6 MB on disk for `pi`), and the dev server otherwise transforms,
 * holds and sends the whole file for every set an app imports from: about
 * 70 MB of JavaScript per ERP page load, and hundreds of MB in its memory.
 *
 * Each set becomes ONE module holding every icon the code imports from it,
 * found by one scan of the app and the workspace packages, so a page
 * makes one request per set, as before. An icon added while the server runs
 * gives that set a new version: files transformed from then on import the new
 * module, files already loaded keep the one they have, and nothing reloads.
 *
 * `react-icons` is kept out of dependency pre-bundling, which would otherwise
 * still build every set whole for modules nothing loads; its small `lib`
 * (`GenIcon`) is served as it is. A build is unaffected (`apply`).
 *
 * @returns {import("vite").Plugin}
 */
function iconImports() {
  /** @type {Map<string, Set<string>>} */
  let used = new Map();
  /** @type {string[]} */
  let scanDirectories = [];
  let scanned = false;
  // Once, on the first icon import: about 0.7 s over the ERP and packages.
  const ensureScanned = () => {
    if (scanned) return;
    scanned = true;
    for (const [set, names] of scanIconImports(scanDirectories)) {
      const all = used.get(set) ?? new Set();
      for (const name of names) all.add(name);
      used.set(set, all);
    }
  };
  /** @type {Map<string, number>} */
  const versions = new Map();
  /** @type {string | undefined} */
  let packageDirectory;
  return {
    name: "carbon:icon-imports",
    apply: "serve",
    enforce: "pre",
    config: () => ({ optimizeDeps: { exclude: ["react-icons"] } }),
    configResolved(config) {
      const require = createRequire(path.join(config.root, "package.json"));
      try {
        // `lib`'s CommonJS entry, `<package>/lib/index.js`.
        packageDirectory = path.dirname(
          path.dirname(require.resolve("react-icons/lib"))
        );
      } catch {
        return; // The app does not depend on react-icons; nothing to rewrite.
      }
      scanDirectories = [
        path.join(config.root, "app"),
        path.join(workspaceRoot(config.root), "packages"),
      ];
    },
    transform: {
      filter: {
        id: { exclude: /[\\/]node_modules[\\/]/ },
        code: "react-icons/",
      },
      handler(code) {
        if (!packageDirectory) return;
        ensureScanned();
        for (const [set, names] of findIconImports(code)) {
          const all = used.get(set) ?? new Set();
          const size = all.size;
          for (const name of names) all.add(name);
          used.set(set, all);
          if (all.size !== size) versions.set(set, (versions.get(set) ?? 0) + 1);
        }
        const next = rewriteIconImports(code, (set) =>
          String(versions.get(set) ?? 0)
        );
        // An unchanged map: only import specifiers moved.
        return next === null ? undefined : { code: next, map: null };
      },
    },
    resolveId: {
      filter: { id: new RegExp(`^${ICON_MODULE_PREFIX}`) },
      handler: (id) => `\0${id}`,
    },
    load: {
      filter: { id: new RegExp(`^\0${ICON_MODULE_PREFIX}`) },
      handler(id) {
        if (!packageDirectory) return;
        ensureScanned();
        const set = id.slice(ICON_MODULE_PREFIX.length + 1).split(":")[0];
        // Read on each load, not kept: a set's source is up to a few MB, and a
        // set loads again only when a new icon bumps its version.
        const source = fs.readFileSync(
          path.join(packageDirectory, set, "index.mjs"),
          "utf8"
        );
        // Every name so far: a version only ever grows, so each importer's
        // names are in the module its version names. No sourcemap: the code
        // is copied verbatim, and Vite's generated one quadrupled the module.
        return {
          code: extractIcons(source, set, used.get(set) ?? []),
          map: { mappings: "" },
        };
      },
    },
  };
}

// `@carbon/database/dataset-assets`: the `assets` declaration at the start of
// a line, up to the glob call's closing `});`. Anchored, so a comment that
// quotes it does not match.
const DATASET_ASSET_GLOB = /^const assets = \([\s\S]*?\)\.glob\([\s\S]*?\n\}\);/m;
const DATASET_ASSET_FILE = /\.(svg|glb|json)$/;

/**
 * Replaces the dataset-asset glob with a literal map of its URLs. Returns
 * null when the glob is not in the shape `assets.ts` writes it, so the caller
 * leaves the file to Vite's glob.
 *
 * @param {string} code
 * @param {Iterable<[string, string]>} entries glob key (`./assets/…`) → URL
 * @returns {string | null}
 */
export function inlineDatasetAssetGlob(code, entries) {
  if (!DATASET_ASSET_GLOB.test(code)) return null;
  const map = JSON.stringify(Object.fromEntries(entries));
  return code.replace(
    DATASET_ASSET_GLOB,
    () => `const assets: Record<string, string> = ${map};`
  );
}

/**
 * The URL a Vite dev `?url` module exports: `export default "…"` in the
 * browser, `const __vite_ssr_export_default__ = "…"` once Vite has turned it
 * into an SSR module. Null for anything else.
 *
 * @param {string} code
 * @returns {string | null}
 */
export function assetModuleUrl(code) {
  const literal =
    /(?:^|\n)(?:export default|const __vite_ssr_export_default__ =) ("(?:[^"\\]|\\.)*")/.exec(
      code
    )?.[1];
  return literal === undefined ? null : JSON.parse(literal);
}

/**
 * The files the dataset-asset glob covers, relative to `directory` and
 * sorted, or null when the directory cannot be read.
 *
 * @param {string} directory
 * @returns {Promise<string[] | null>}
 */
export async function listDatasetAssetFiles(directory) {
  try {
    return (await readdir(directory, { recursive: true }))
      .filter((file) => DATASET_ASSET_FILE.test(file))
      .sort();
  } catch {
    return null;
  }
}

/**
 * The demo-template asset glob (`@carbon/database/dataset-assets`) as one
 * module in dev. Vite serves an eager `?url` glob as one module per file
 * (about 180 SVG, GLB and graph files), and every page loads them all through
 * the topbar's `@carbon/files/media`. This plugin asks Vite for each file's
 * `?url` module on the server and writes the URLs it gets into `assets.ts`,
 * so every URL, an inlined small SVG included, is the one the glob gives. An
 * edited or added asset rebuilds the map. A build is unaffected (`apply`).
 *
 * @returns {import("vite").Plugin}
 */
function datasetAssets() {
  return {
    name: "carbon:dataset-assets",
    apply: "serve",
    enforce: "pre",
    // Built at startup, so the first page does not wait for 180 transforms.
    configureServer(server) {
      const require = createRequire(path.join(server.config.root, "package.json"));
      let file;
      try {
        file = require.resolve("@carbon/database/dataset-assets");
      } catch {
        return; // The app does not use the demo assets.
      }
      server.environments.client.warmupRequest(file);
      // A new asset rebuilds the map, as the glob would pick it up. The
      // directory sits outside the app root, so Vite does not watch it.
      const directory = path.join(path.dirname(file), "assets");
      server.watcher.add(directory);
      server.watcher.on("add", (added) => {
        if (!added.startsWith(directory + path.sep)) return;
        if (!DATASET_ASSET_FILE.test(added)) return;
        for (const environment of Object.values(server.environments)) {
          for (const module of environment.moduleGraph.getModulesByFile(
            normalizePath(file)
          ) ??
            []) {
            environment.reloadModule(module);
          }
        }
      });
    },
    transform: {
      filter: {
        id: /[\\/]packages[\\/]database[\\/]src[\\/]datasets[\\/]assets\.ts$/,
      },
      async handler(code, id) {
        const directory = path.join(path.dirname(id), "assets");
        const files = await listDatasetAssetFiles(directory);
        // Unreadable: leave the glob to Vite, as for anything unexpected.
        if (files === null) return;
        // An edited asset (a small SVG is inlined as a data URL) rebuilds
        // the map, as it would invalidate the glob.
        for (const file of files) this.addWatchFile(path.join(directory, file));
        // A DevEnvironment: the plugin only runs in serve.
        const environment = /** @type {any} */ (this.environment);
        // All at once: this module waits on them, and so does every page.
        const urls = await Promise.all(
          files.map(async (file) => {
            const result = await environment.transformRequest(
              `${normalizePath(path.join(directory, file))}?url`
            );
            return assetModuleUrl(result?.code ?? "");
          })
        );
        // Anything unexpected: leave the glob to Vite.
        if (urls.some((url) => url === null)) return;
        const next = inlineDatasetAssetGlob(
          code,
          files.map((file, index) => [
            `./assets/${file.split(path.sep).join("/")}`,
            /** @type {string} */ (urls[index]),
          ])
        );
        return next === null ? undefined : { code: next, map: null };
      },
    },
  };
}

/**
 * Dev-server only: disconnects a page that stopped reading HMR messages. A
 * page the browser keeps connected but no longer runs (seen with headless
 * Chrome's earlier pages; a frozen or cached tab can do the same) never reads,
 * and Vite writes every update to it:
 * the unsent bytes stay in the dev server's memory, about 2 MB per edit for
 * each such page in the ERP. A page that wakes up finds the server gone, then
 * reconnects and reloads (Vite's client does this), as it must after missing
 * updates. A page that reads but is slow (a tunnel, a busy tab) drains some
 * of its backlog between two checks, so only a backlog over the limit that has
 * not shrunk since the last check counts as stalled.
 *
 * @returns {import("vite").Plugin}
 */
export function dropStalledHmrClients() {
  const LIMIT = 4 * 1024 * 1024;
  return {
    name: "carbon:drop-stalled-hmr-clients",
    apply: "serve",
    configureServer(server) {
      /** @type {WeakMap<object, number>} */
      const previous = new WeakMap();
      const timer = setInterval(() => {
        for (const { socket } of server.ws.clients) {
          const unsent = socket.bufferedAmount;
          const before = previous.get(socket);
          previous.set(socket, unsent);
          if (unsent > LIMIT && before !== undefined && unsent >= before) {
            socket.terminate();
          }
        }
      }, 5000);
      timer.unref();
      server.httpServer?.once("close", () => clearInterval(timer));
    },
  };
}

/**
 * Every Carbon app's own Vite plugins, in one call. React Router and
 * Tailwind stay in the app's config, as the framework and styling plugins.
 *
 * Always on: stack activity (a no-op outside `crbn up`), per-icon react-icons
 * imports in dev (`iconImports`), the demo-asset glob as one module in dev
 * (`datasetAssets`), dropping HMR clients that stopped reading
 * (`dropStalledHmrClients`), and Lingui's macro transform with the React
 * Router id fix. The rest is opt-in, and a package
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
  cloudWarmup,
} = {}) {
  if (precompress && !(command && mode)) {
    throw new Error("carbon({ precompress }) needs the config's command and mode");
  }
  const { lingui } = await import("@lingui/vite-plugin");
  return [
    stackActivity(),
    cloudDevServer(cloudWarmup),
    iconImports(),
    datasetAssets(),
    dropStalledHmrClients(),
    linguiWithoutIdQuery(lingui({ macroTransform: true })),
    splitServer && splitServerByPackage(),
    precompress && precompressedAssets({ command, mode }),
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
