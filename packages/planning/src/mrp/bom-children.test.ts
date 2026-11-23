// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { bomChildren } from "./bom-children.ts";

describe("bomChildren", () => {
  it("keeps each line's quantity", () => {
    expect(
      bomChildren([
        { itemId: "ring", quantity: 4, methodType: "Pull from Inventory" },
        { itemId: "steel", quantity: "12.5", methodType: "Pull from Inventory" }
      ])
    ).toEqual([
      { itemId: "ring", quantity: 4, methodType: "Pull from Inventory" },
      { itemId: "steel", quantity: 12.5, methodType: "Pull from Inventory" }
    ]);
  });

  it("leaves out lines with no quantity instead of counting them as one", () => {
    // A configured trailer: the default body at 1, the other configurations at 0.
    expect(
      bomChildren([
        { itemId: "body-12ft", quantity: 1, methodType: "Make to Order" },
        { itemId: "body-14ft", quantity: 0, methodType: "Make to Order" },
        { itemId: "body-16ft", quantity: "0", methodType: "Make to Order" },
        { itemId: "unset", quantity: null, methodType: "Pull from Inventory" }
      ])
    ).toEqual([
      { itemId: "body-12ft", quantity: 1, methodType: "Make to Order" }
    ]);
  });
});
