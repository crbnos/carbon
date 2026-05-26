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
      ],
    },
    server: {
      port: 3000,
      strictPort: true,
      allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".dev", ".localhost"],
      watch: {
        awaitWriteFinish: { stabilityThreshold: 250 },
      },
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
        "@carbon/utils": path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts",
        ),
        "@carbon/form": path.resolve(
          __dirname,
          "../../packages/form/src/index.tsx",
        ),
      },
    },
    // Per-environment aliases. The `node:async_hooks` stub MUST be applied
    // only to the client environment — the SSR environment runs on Node and
    // needs the real module so `AsyncLocalStorage` actually carries context
    // across awaits. Putting this in the top-level `resolve.alias` (or in a
    // `!isSsrBuild` block) applies it to both environments in dev mode,
    // which silently neuters server-side ALS — AuthClientScope.run becomes
    // a no-op and `getStore()` always returns undefined.
    environments: {
      client: {
        resolve: {
          alias: {
            "node:async_hooks": path.resolve(
              __dirname,
              "app/stubs/async_hooks.ts",
            ),
          },
        },
      },
    },
  };
});
