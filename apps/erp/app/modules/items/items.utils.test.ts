// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  trackingTypeChangeRefusal,
  trackingTypeIssueRefusal,
  trackingTypeLotRefusal
} from "./items.utils";

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

// Batch and serial stock is returned by unit, so quantity an open job issued
// with no number keeps the item's tracking type until it is returned or the
// job is finished.
describe("trackingTypeIssueRefusal", () => {
  it.each(["Batch", "Serial"] as const)(
    "refuses making an item issued by quantity %s, naming item and jobs",
    (newType) => {
      const refusal = trackingTypeIssueRefusal(newType, [
        { item: "PART-1", job: "J000001" },
        { item: "PART-1", job: "J000002" }
      ]);
      expect(refusal).toContain("PART-1 is issued");
      expect(refusal).toContain("J000001, J000002");
    }
  );

  it("allows Batch or Serial when no open job issued the item", () => {
    expect(trackingTypeIssueRefusal("Batch", [])).toBeNull();
    expect(trackingTypeIssueRefusal("Serial", [])).toBeNull();
  });

  it.each(["Inventory", "Non-Inventory"] as const)(
    "never refuses a change to %s",
    (newType) => {
      expect(
        trackingTypeIssueRefusal(newType, [{ item: "PART-1", job: "J000001" }])
      ).toBeNull();
    }
  );
});

// A serial number is one unit, so a batch of several units keeps the item
// from becoming Serial until it is adjusted out.
describe("trackingTypeLotRefusal", () => {
  it("refuses making an item with a multi-unit batch Serial, naming it", () => {
    expect(trackingTypeLotRefusal("Serial", ["PART-1"])).toContain(
      "PART-1 has batches"
    );
  });

  it("allows Serial when no batch holds more than one unit", () => {
    expect(trackingTypeLotRefusal("Serial", [])).toBeNull();
  });

  it.each(["Batch", "Inventory", "Non-Inventory"] as const)(
    "never refuses a change to %s",
    (newType) => {
      expect(trackingTypeLotRefusal(newType, ["PART-1"])).toBeNull();
    }
  );
});
