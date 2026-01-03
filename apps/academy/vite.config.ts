import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    sourcemap: false,
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
  optimizeDeps: {
    extensions: [".css", ".scss", ".sass"], // explicitly include CSS extensions if needed
  },
  ssr: {
    noExternal: [
      "react-dropzone",
      "react-icons",
      "react-phone-number-input",
      "tailwind-merge",
    ],
  },
  server: {
    port: 4111,
  },
  plugins: [reactRouter(), tsconfigPaths()] as PluginOption[],
  resolve: {
    alias: {
      "@carbon/utils": path.resolve(
        __dirname,
        "../../packages/utils/src/index.ts"
      ),
      "@carbon/form": path.resolve(
        __dirname,
        "../../packages/form/src/index.tsx"
      ),
    },
  },
}));
