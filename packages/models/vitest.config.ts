// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import baseConfig from "@carbon/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // An exhaustive search takes 0.3 s alone but over 5 s on a CI runner
      // shared with every other package's tests.
      testTimeout: 60_000
    }
  })
);
