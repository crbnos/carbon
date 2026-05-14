import { lingui } from "@lingui/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { defineConfig, loadEnv, PluginOption } from "vite";
import babelMacros from "vite-plugin-babel-macros";
import tsconfigPaths from "vite-tsconfig-paths";

const repoRoot = path.resolve(__dirname, "../..");

/**
 * Node does not read `.env`; `process.env` is only inherited from the
 * parent process. Vite normally exposes `.env` via `import.meta.env`, while
 * workspace packages (e.g. `@carbon/auth`) read `process.env` — merge file-based
 * env here so SSR and `getEnv()` match your repo-root and app-local `.env*`.
 *
 * Repo root is merged **after** `apps/erp` so `crbn up`–written root `.env.local`
 * (SUPABASE_URL, PORT_*, keys) overrides stale app-level copies (e.g. legacy
 * `http://127.0.0.1:54321` from `supabase start`).
 *
 * For any **non-production** Vite `mode`, merged file values overwrite existing
 * `process.env` keys. `react-router dev` can invoke config with modes other
 * than the string `development` during startup; that left stale shell
 * `SUPABASE_URL` (e.g. `127.0.0.1:54321`) in place. Production `vite build` uses
 * `mode === "production"` and keeps fill-only-undefined so CI can inject secrets.
 */
function applyDotenvToProcessEnv(mode: string) {
  const fromFiles = {
    ...loadEnv(mode, __dirname, ""),
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

export default defineConfig(({ isSsrBuild, mode }) => {
  applyDotenvToProcessEnv(mode);

  return {
    build: {
      minify: true,
      rollupOptions: {
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
      allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".dev", ".localhost"],
      watch: {
        awaitWriteFinish: { stabilityThreshold: 250 },
      },
    },
    plugins: [
      babelMacros(),
      lingui(),
      reactRouter(),
      tsconfigPaths(),
    ] as PluginOption[],
    resolve: {
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
  };
});
