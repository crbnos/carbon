// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { linguiWithoutIdQuery } from "@carbon/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { lingui } from "@lingui/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

const PORT = Number(process.env.HARNESS_PORT ?? 3999);

export default defineConfig({
  root: import.meta.dirname,
  // The harness is a dev tool: its port is fixed so scripts/harness-shot.mjs can find it.
  server: { port: PORT, strictPort: true, fs: { strict: false } },
  plugins: [tailwindcss(), linguiWithoutIdQuery(lingui({ macroTransform: true }))],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@carbon/utils": path.resolve(import.meta.dirname, "../../../packages/utils/src"),
      "@carbon/form": path.resolve(import.meta.dirname, "../../../packages/form/src/index.tsx")
    }
  }
});
