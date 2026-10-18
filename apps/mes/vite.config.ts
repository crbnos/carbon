// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { applyDotenvToProcessEnv, carbon } from "@carbon/dev/vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode, isSsrBuild }) => {
  applyDotenvToProcessEnv(mode, import.meta.dirname);

  /**
   * Dev-server SSR dependencies that must be inlined rather than left as bare
   * `import`s. A production build inlines every dependency (see the ERP's
   * vite.config.ts for why). Applied to BOTH `ssr` and
   * `environments.ssr.resolve`.
   *
   * The second location is not redundant: with `future.v8_viteEnvironmentApi`
   * enabled, the Vercel preset builds each route group as a named server-bundle
   * environment (`ssr_bundle_*`), and React Router's server-bundle environment
   * resolver merges `viteUserConfig.environments.ssr` — NOT the top-level `ssr`
   * config.
   */
  const ssrNoExternal = [
    "react-dropzone",
    /**
     * sonner's stylesheet is imported as `dist/styles.css?url` from root.tsx.
     * Externalized, the dev SSR module runner hands the resolved path with
     * its query straight to Node, which cannot load it ("Cannot find module
     * ...styles.css?url"). Inlined, the ?url import goes through Vite's
     * asset pipeline. The production build is unaffected either way.
     */
    "sonner",
    "react-icons",
    "react-phone-number-input",
    "tailwind-merge",
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

  const ssrResolve =
    command === "build"
      ? { noExternal: true as const }
      : { noExternal: ssrNoExternal };

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
     * Label logos (`@carbon/documents/labels` → `@carbon/files/media/node`)
     * import the jSquash wasm codecs as `?inline` data URIs. Vite only honours
     * `?inline` for a file it treats as an asset, and `.wasm` is not one by
     * default. Same setting as the ERP's.
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
    ssr: ssrResolve,
    environments: {
      ssr: {
        resolve: ssrResolve,
        // Bundled CommonJS that reads __dirname/__filename (yoga-layout under
        // react-pdf, libheif) runs in ES module output, where neither exists.
        ...(command === "build" && {
          define: {
            __dirname: "import.meta.dirname",
            __filename: "import.meta.filename",
          },
        }),
      },
    },
    server: {
      port: 3001,
      strictPort: true,
      allowedHosts: [".ngrok-free.app", ".w.modal.host", ".w.modal.dev", ".dev", ".localhost", "host.docker.internal"],
    },
    plugins: [
      tailwindcss(),
      reactRouter(),
      carbon({
        command,
        mode,
        locales: true,
        precompress: true,
        splitServer: true,
        // unpdf's bundled PDF.js engine is a dead lazy chunk in the browser,
        // which runs react-pdf's pdfjs-dist (see @carbon/files/pdf). Keep it
        // out there only: on the server it is the one engine PDF reading has.
        clientOnly: {
          "unpdf/pdfjs": path.resolve(
            import.meta.dirname,
            "app/ssr-shims/unpdf-pdfjs-stub.mjs"
          ),
        },
      }),
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        /**
         * Konva's Node entry (`index-node.js`) requires native `canvas`. Vite SSR
         * can still load that graph; alias `canvas` to a stub (do not alias the
         * konva entry itself — the drawing pane needs the real browser build).
         */
        canvas: path.resolve(import.meta.dirname, "app/ssr-shims/canvas-stub.cjs"),
        /**
         * `rhino3dm` (via @carbon/viewer) has a Node-only branch that
         * `require("ws")`, but declares no dependencies, so `ws` is not
         * resolvable from it. Rolldown (Vite 8) resolves that statically while
         * bundling the viewer's worker entry and fails the build; esbuild did
         * not. Nothing here uses `ws` — stub it like `canvas` above.
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
