import { applyDotenvToProcessEnv } from "@carbon/dev/vite";
import { lingui } from "@lingui/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";
import babelMacros from "vite-plugin-babel-macros";

export default defineConfig(({ isSsrBuild, mode }) => {
  applyDotenvToProcessEnv(mode, __dirname);

  return {
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
      noExternal: [
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
         */
        "react-csv",
        /**
         * @react-three/fiber v8 (inlined via @carbon/viewer) default-imports
         * its nested zustand v3, while the app uses zustand v5 (no default
         * export). Externalizing zustand merges both into one bare import that
         * resolves to v5 at runtime and crashes the server at module load.
         * Bundling it lets each importer keep its own version.
         */
        "zustand",
      ],
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
      tailwindcss(),
      babelMacros(),
      lingui(),
      reactRouter(),
    ] as PluginOption[],
    resolve: {
      tsconfigPaths: true,
      alias: {
        /**
         * Konva's Node entry (`index-node.js`) requires native `canvas`. Vite SSR
         * can still load that graph; alias `canvas` to a stub (do not alias the
         * whole `konva` package — react-konva imports `konva/lib/Core.js`, etc.).
         */
        canvas: path.resolve(__dirname, "app/ssr-shims/canvas-stub.cjs"),
        /**
         * `rhino3dm` (via @carbon/viewer) has a Node-only branch that
         * `require("ws")`, but declares no dependencies, so `ws` is not
         * resolvable from it. Rolldown (Vite 8) resolves that statically and
         * fails the build; esbuild did not. Nothing here uses `ws` — stub it
         * like `canvas` above.
         */
        ws: path.resolve(__dirname, "app/ssr-shims/ws-stub.cjs"),
        // Directory (not index.ts) so subpath imports like
        // `@carbon/utils/favicon` resolve to `src/favicon.ts`.
        "@carbon/utils": path.resolve(__dirname, "../../packages/utils/src"),
        "@carbon/form": path.resolve(
          __dirname,
          "../../packages/form/src/index.tsx",
        ),
      },
    },
  };
});
