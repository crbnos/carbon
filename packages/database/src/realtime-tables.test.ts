// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  REALTIME_REFERENCE_TABLES,
  REALTIME_TABLES,
  REALTIME_USER_TABLES
} from "./realtime-tables";

it("names each table once, in one list", () => {
  const all = [
    ...REALTIME_TABLES,
    ...REALTIME_REFERENCE_TABLES,
    ...REALTIME_USER_TABLES
  ];
  expect(new Set(all).size).toBe(all.length);
});
