// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { FixedAssetWrites } from "./fixed-asset-writes";

it("shows a later line what an earlier line of the document staged", () => {
  const writes = new FixedAssetWrites();
  // Two lines of one receipt capitalise onto the same asset: the second must
  // add to the first's cost, not to the cost still stored in the database.
  const stored = () => ({ acquisitionCost: 100, status: "Draft" });

  const first = writes.overlay("fa1", stored());
  writes.patch("fa1", {
    acquisitionCost: first.acquisitionCost + 40,
    status: "Active"
  });

  const second = writes.overlay("fa1", stored());
  expect(second).toEqual({ acquisitionCost: 140, status: "Active" });
  writes.patch("fa1", { acquisitionCost: second.acquisitionCost + 10 });

  expect(writes.overlay("fa1", stored())).toEqual({
    acquisitionCost: 150,
    status: "Active"
  });
  // Another asset is untouched.
  expect(writes.overlay("fa2", stored())).toEqual(stored());
});
