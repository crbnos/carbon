import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";
import path from "node:path";
import { flatRoutes } from "remix-flat-routes";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  ssr: {
    noExternal: [
      "react-tweet",
      "react-dropzone",
      "react-icons",
      "react-phone-number-input",
    ],
  },
  server: {
    port: 3001,
  },
  plugins: [
    remix({
      presets: [vercelPreset()],
      future: {
        unstable_singleFetch: true,
      },
      ignoredRouteFiles: ["**/.*"],
      serverModuleFormat: "esm",
      routes: async (defineRoutes) => {
        return flatRoutes("routes", defineRoutes, {
          // eslint-disable-next-line no-undef
          appDir: path.resolve(__dirname, "app"),
        });
      },
    }),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "@carbon/documents": path.resolve(
        __dirname,
        "../../packages/documents/src/index.tsx"
      ),
      "@carbon/utils": path.resolve(
        __dirname,
        "../../packages/utils/src/index.ts"
      ),
      "@carbon/remix-validated-form": path.resolve(
        __dirname,
        "../../packages/remix-validated-form/src/index.tsx"
      ),
      "@carbon/logger": path.resolve(
        __dirname,
        "../../packages/logger/src/index.ts"
      ),
    },
  },
});
