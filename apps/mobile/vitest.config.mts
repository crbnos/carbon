// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineConfig } from "vitest/config";

/**
 * Node-only unit tests for the app's PURE logic — the outbox policy, address
 * resolution, scan parsing, error mapping, theme-token drift. React Native
 * components are verified on real devices (see AGENTS.md), not in jsdom.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true
  },
  resolve: {
    alias: {
      "@carbon/mes-core": new URL(
        "../../packages/mes-core/src/index.ts",
        import.meta.url
      ).pathname
    }
  }
});
