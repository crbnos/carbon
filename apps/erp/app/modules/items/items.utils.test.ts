// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { trackingTypeChangeRefusal } from "./items.utils";

// Batch and serial stock belongs to a numbered unit, so an item holding stock
// with no number keeps its tracking type until that stock is adjusted out.
describe("trackingTypeChangeRefusal", () => {
  it.each(["Batch", "Serial"] as const)(
    "refuses making an item with unnumbered stock %s, naming it",
    (newType) => {
      const refusal = trackingTypeChangeRefusal(newType, ["PART-1", "PART-2"]);
      expect(refusal).toContain("PART-1");
      expect(refusal).toContain("PART-2");
    }
  );

  it("names the first five items of a long list", () => {
    const items = ["A", "B", "C", "D", "E", "F", "G"].map((id) => `ITEM-${id}`);
    const refusal = trackingTypeChangeRefusal("Batch", items);
    expect(refusal).toContain("ITEM-E");
    expect(refusal).not.toContain("ITEM-F");
  });

  it("allows Batch or Serial when no item holds unnumbered stock", () => {
    expect(trackingTypeChangeRefusal("Batch", [])).toBeNull();
    expect(trackingTypeChangeRefusal("Serial", [])).toBeNull();
  });

  it.each(["Inventory", "Non-Inventory"] as const)(
    "never refuses a change to %s",
    (newType) => {
      expect(trackingTypeChangeRefusal(newType, ["PART-1"])).toBeNull();
    }
  );
});
