// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Imported only on Vercel: the preset's module loads ts-morph, and with it a
  // TypeScript compiler (~30 MB of heap), into every dev server.
  presets: process.env.VERCEL
    ? [(await import("@vercel/react-router/vite")).vercelPreset()]
    : undefined,
  future: { unstable_optimizeDeps: true, v8_middleware: true, v8_viteEnvironmentApi: true },
} satisfies Config;
