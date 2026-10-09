// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  applyDotenvToProcessEnv,
  clientOnlyAlias,
  linguiWithoutIdQuery,
  precompressedAssets,
  stackActivity,
} from "@carbon/dev/vite";
import { getConfig } from "@lingui/conf";
import { lingui } from "@lingui/vite-plugin";
import optimizeLocales from "@react-aria/optimize-locales-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";

export default defineConfig(({ command, isSsrBuild, mode }) => {
  applyDotenvToProcessEnv(mode, import.meta.dirname);

  // One id per build, the same in the client and server bundles. `path.to.api`
  // puts it on the reference lists the browser keeps for a day, so a deploy
  // is never served the copy cached under the previous one. The deployment on
  // Vercel (a redeploy of one commit can still change what those lists hold);
  // elsewhere the build's own start time, which also changes per build.
  process.env.VITE_BUILD_ID ??=
    process.env.VERCEL_DEPLOYMENT_ID?.replace(/^dpl_/, "").slice(0, 12) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
    Date.now().toString(36);

  /**
   * SSR dependencies that must be bundled into the server output rather than
   * left as bare `import`s. Defined once and applied to BOTH `ssr.noExternal`
   * (honored by the dev server and the plain `react-router build`) and
   * `environments.ssr.resolve.noExternal`.
   *
   * The second location is not redundant: with `future.v8_viteEnvironmentApi`
   * enabled, the Vercel preset builds each route group as a named server-bundle
   * environment (`ssr_bundle_*`), and React Router's server-bundle environment
   * resolver merges `viteUserConfig.environments.ssr` — NOT the top-level `ssr`
   * config. Without this, every entry below is externalized in the Vercel
   * Lambda, and `zustand` (default-imported by @react-three/fiber, see below)
   * crashes the function on cold start with "does not provide an export named
   * 'default'".
   */
  const ssrNoExternal = [
    "react-tweet",
    "react-dropzone",
    "react-icons",
    "react-phone-number-input",
    "tailwind-merge",
    /**
     * react-csv@2.2.2 ships a broken manifest: it `require('react')` and
     * `require('prop-types')` at runtime but declares neither as a
     * dependency or peer. Externalized, the SSR server bundle keeps the bare
     * `require('react')`, which resolves locally via pnpm's hoisted store
     * but is NOT traced into the Vercel serverless function — so the Lambda
     * crashes on cold start with "Cannot find module 'react'". Bundling it
     * inline resolves react/prop-types against the app's copies at build
     * time, the same reason the react-* packages above are inlined.
     *
     * Build-only: react-csv also declares `"jsnext:main": "src/index.js"`,
     * so when inlined in the dev server Vite picks the untranspiled ESM
     * source, whose `import { func } from "prop-types"` fails under Node's
     * CJS interop ("Named export 'func' not found"). In dev the CJS entry is
     * externalized and `require`d directly, which works via pnpm's store.
     * (Gated on `command` — not `isSsrBuild` — because under the environment
     * API the config callback runs once for the whole build, so `isSsrBuild`
     * is unreliable, whereas `command` is always "build" vs "serve".)
     */
    ...(command === "build" ? ["react-csv"] : []),
    /**
     * @react-three/fiber v8 (inlined via @carbon/viewer) default-imports
     * its nested zustand v3, while the app uses zustand v5 (no default
     * export). Externalizing zustand merges both into one bare import that
     * resolves to v5 at runtime and crashes the server at module load.
     * Bundling it lets each importer keep its own version.
     */
    "zustand",
    /**
     * @carbon/react imports each avatar style's JSON with a dynamic import().
     * Externalized, Node loads that JSON natively and refuses it without an
     * import attribute (ERR_IMPORT_ATTRIBUTE_MISSING), so /file/avatar fails.
     * The attribute cannot go in the source: Vite passes it to the browser,
     * which then rejects the JSON it serves as JavaScript. Bundled, Vite turns
     * the JSON into a module on both sides.
     */
    "@dicebear/styles",
  ];

  return {
    // ASSETS_URL bakes a CDN asset base into the client build (Dockerfile
    // build arg). Vite's base is build-time only, so an image built without
    // it serves assets same-origin — that IS the controlled/air-gapped
    // variant, not a fallback. Normalized: Vite requires the trailing slash.
    base:
      command === "build" && process.env.ASSETS_URL
        ? process.env.ASSETS_URL.replace(/\/*$/, "/")
        : undefined,
    // Build analysis (plugin hook cost, chunks, duplicate packages). Opt-in,
    // because each build writes gigabytes to node_modules/.rolldown:
    // `VITE_DEVTOOLS=1 pnpm build`, then `pnpm exec vite-devtools`.
    devtools: Boolean(process.env.VITE_DEVTOOLS),
    /**
     * The jSquash image codecs (paperless thumbnails, via
     * `@carbon/files/media/node`) import their wasm as `?inline` data URIs, so
     * the bytes ride in the server bundle instead of being resolved off disk at
     * runtime — a bundled `require.resolve` is anchored in the output directory,
     * where neither `@jsquash` nor the .wasm exists. Vite only honours `?inline`
     * for a file it treats as an asset, and `.wasm` is not one by default.
     */
    assetsInclude: ["**/*.wasm"],
    build: {
      minify: true,
      rolldownOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === "SOURCEMAP_ERROR") {
            return;
          }

          defaultHandler(warning);
        },
        ...(isSsrBuild && { input: "./server/app.ts" }),
      },
    },
    define: {
      global: "globalThis",
    },
    ssr: {
      noExternal: ssrNoExternal,
    },
    environments: {
      ssr: {
        resolve: {
          noExternal: ssrNoExternal,
        },
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      allowedHosts: [
        ".ngrok-free.app",
        ".ngrok-free.dev",
        ".trycloudflare.com",
        ".dev",
        ".localhost",
      ],
    },
    plugins: [
      stackActivity(),
      tailwindcss(),
      linguiWithoutIdQuery(lingui({ macroTransform: true })),
      reactRouter(),
      precompressedAssets({ command, mode }),
      // react-aria ships strings for ~34 locales; keep the ones the app translates.
      optimizeLocales.vite({ locales: getConfig().locales }),
      // unpdf's bundled PDF.js engine is a dead lazy chunk in the browser, which
      // runs react-pdf's pdfjs-dist (see @carbon/files/pdf). Keep it out there
      // only: on the server it is the one engine PDF reading has.
      clientOnlyAlias(
        "unpdf/pdfjs",
        path.resolve(import.meta.dirname, "app/ssr-shims/unpdf-pdfjs-stub.mjs")
      ),
    ] as PluginOption[],
    resolve: {
      tsconfigPaths: true,
      alias: {
        /**
         * Konva's Node entry (`index-node.js`) requires native `canvas`. Vite SSR
         * can still load that graph; alias `canvas` to a stub (do not alias the
         * whole `konva` package — react-konva imports `konva/lib/Core.js`, etc.).
         */
        canvas: path.resolve(import.meta.dirname, "app/ssr-shims/canvas-stub.cjs"),
        /**
         * `rhino3dm` (via @carbon/viewer) has a Node-only branch that
         * `require("ws")`, but declares no dependencies, so `ws` is not
         * resolvable from it. Rolldown (Vite 8) resolves that statically and
         * fails the build; esbuild did not. Nothing here uses `ws` — stub it
         * like `canvas` above.
         */
        ws: path.resolve(import.meta.dirname, "app/ssr-shims/ws-stub.cjs"),
        // Directory (not index.ts) so subpath imports like
        // `@carbon/utils/favicon` resolve to `src/favicon.ts`.
        "@carbon/utils": path.resolve(import.meta.dirname, "../../packages/utils/src"),
        "@carbon/form": path.resolve(
          import.meta.dirname,
          "../../packages/form/src/index.tsx"
        ),
      },
    },
  };
});
