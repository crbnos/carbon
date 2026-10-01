// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { getFunctionLogger } from "./logging.ts";

Deno.test({
  name: "logger defaults safely when environment access is denied",
  permissions: { env: false },
  fn: () => {
    const logger = getFunctionLogger("permissionless-test");

    assertEquals(logger.category, ["carbon", "edge", "permissionless-test"]);
  },
});
