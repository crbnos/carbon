// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { shortfallAction } from "../app/modules/production/production.models";

// The job materials Status badge says "Make N" or "Order N" for a short line.

describe("shortfallAction", () => {
  it("makes a made part the line pulls from stock", () => {
    expect(shortfallAction("Pull from Inventory", "Make")).toBe("make");
  });

  it("orders a made part the line buys", () => {
    expect(shortfallAction("Purchase to Order", "Make")).toBe("order");
  });

  it("orders a bought part, and a Buy and Make part as MRP plans it", () => {
    expect(shortfallAction("Pull from Inventory", "Buy")).toBe("order");
    expect(shortfallAction("Pull from Inventory", "Buy and Make")).toBe(
      "order"
    );
  });

  it("orders when the item's replenishment is unknown", () => {
    expect(shortfallAction("Pull from Inventory", undefined)).toBe("order");
  });
});
