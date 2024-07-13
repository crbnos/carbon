import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { vercelPreset } from "@vercel/remix/vite";
import path from "node:path";
import { flatRoutes } from "remix-flat-routes";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals();

export default defineConfig({
  ssr: {
    noExternal: ["react-dropzone", "react-icons", "react-phone-number-input"],
  },
  server: {
    port: 3000,
  },
  plugins: [
    remix({
      // appDirectory: "app",
      // assetsBuildDirectory: "public/build",
      // publicPath: "/build/",
      // serverBuildPath: "build/index.js",
      //browserNodeBuiltinsPolyfill: { modules: { events: true } },
      // dev: {
      //   port: 3601,
      // },
      presets: [vercelPreset()],
      future: {},
      ignoredRouteFiles: ["**/.*"],
      serverModuleFormat: "esm",
      //serverPlatform: "node",
      //serverMinify: false,
      routes: async (defineRoutes) => {
        return flatRoutes("routes", defineRoutes, {
          // eslint-disable-next-line no-undef
          appDir: path.resolve(__dirname, "app"),
        });
      },
      // serverDependenciesToBundle: [
      //   "@carbon/database",
      //   "@carbon/documents",
      //   "@carbon/logger",
      //   "@carbon/react",
      //   "@carbon/remix-validated-form",
      //   "@carbon/utils",
      //   "nanoid",
      //   "nanostores",
      //   "@nanostores/react",
      // ],
      // watchPaths: async () => {
      //   return [
      //     "../../packages/database/src/**/*",
      //     "../../packages/documents/src/**/*",
      //     "../../packages/logger/src/**/*",
      //     "../../packages/react/src/**/*",
      //     "../../packages/utils/src/**/*",
      //   ];
      // },
    }),
    tsconfigPaths(),
  ],
});
