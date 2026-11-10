// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/dev/vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    sourcemap: false,
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
    port: 4000,
    strictPort: true,
  },
  plugins: [tailwindcss(), reactRouter(), carbon()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Directory (not index.ts) so subpath imports like
      // `@carbon/utils/favicon` resolve to `src/favicon.ts`.
      "@carbon/utils": path.resolve(import.meta.dirname, "../../packages/utils/src"),
      "@carbon/form": path.resolve(
        import.meta.dirname,
        "../../packages/form/src/index.tsx"
      ),
    },
  },
}));
