// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import baseConfig from "@carbon/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// The SQL checks read parsed SQL, and the parser loads asynchronously: it is
// loaded once per test file here, so no test has to remember to.
export default mergeConfig(
  baseConfig,
  defineConfig({ test: { setupFiles: ["./src/sources/sql.setup.ts"] } })
);
