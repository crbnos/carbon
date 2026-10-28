// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import base from "@carbon/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// The content modules mark their copy with `msg` from `@lingui/core/macro`,
// a compile-time transform the tests do not run. Point it at a stand-in that
// builds the same descriptors, so logic that reads content can be tested.
export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        "@lingui/core/macro": new URL("./test/lingui-macro.ts", import.meta.url)
          .pathname
      }
    }
  })
);
