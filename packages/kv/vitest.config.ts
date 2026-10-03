// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@carbon/config/vitest";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ["src/ratelimit/**/*.ts"],
      },
    },
  })
);
