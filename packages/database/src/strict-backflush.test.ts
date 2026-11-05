// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  activationRefusalMessage,
  binShortfall,
  missingPullFromLocations,
  needsPullFrom,
  pullFromStorageUnit,
  strictBackflushLockKey,
  summarizeList
} from "./strict-backflush.ts";

describe("needsPullFrom", () => {
  const stocked = {
    methodType: "Pull from Inventory",
    itemType: "Part",
    itemTrackingType: "Inventory"
  };

  it("requires a bin on a pulled, stocked line", () => {
    expect(needsPullFrom(stocked)).toBe(true);
  });

  it("requires a bin on a Purchase to Order line", () => {
    expect(needsPullFrom({ ...stocked, methodType: "Purchase to Order" })).toBe(
      true
    );
  });

  it("requires a bin on batch and serial lines", () => {
    expect(needsPullFrom({ ...stocked, itemTrackingType: "Batch" })).toBe(true);
    expect(needsPullFrom({ ...stocked, itemTrackingType: "Serial" })).toBe(
      true
    );
  });

  it("treats an unknown tracking type as stocked", () => {
    expect(needsPullFrom({ ...stocked, itemTrackingType: null })).toBe(true);
  });

  it("skips a Make to Order line, which is built, not pulled", () => {
    expect(needsPullFrom({ ...stocked, methodType: "Make to Order" })).toBe(
      false
    );
  });

  it("skips a Non-Inventory item, which holds no stock", () => {
    expect(
      needsPullFrom({ ...stocked, itemTrackingType: "Non-Inventory" })
    ).toBe(false);
  });

  it("skips tools and services, which a backflush never consumes", () => {
    expect(needsPullFrom({ ...stocked, itemType: "Tool" })).toBe(false);
    expect(needsPullFrom({ ...stocked, itemType: "Service" })).toBe(false);
  });
});

describe("missingPullFromLocations", () => {
  it("returns the locations with no bin", () => {
    expect(
      missingPullFromLocations({ plant: "bin-1" }, ["plant", "annex"])
    ).toEqual(["annex"]);
  });

  it("treats a cleared bin (empty string) as missing", () => {
    expect(missingPullFromLocations({ plant: "" }, ["plant"])).toEqual([
      "plant"
    ]);
  });

  it("treats a null or malformed map as missing everywhere", () => {
    expect(missingPullFromLocations(null, ["plant"])).toEqual(["plant"]);
    expect(missingPullFromLocations("bin-1", ["plant"])).toEqual(["plant"]);
  });

  it("requires nothing when no location has a work center", () => {
    expect(missingPullFromLocations({}, [])).toEqual([]);
  });
});

describe("binShortfall", () => {
  it("is 0 when the bin covers the quantity", () => {
    expect(binShortfall({ onHand: 10, alreadyDrawn: 0, quantity: 10 })).toBe(0);
  });

  it("is the uncovered quantity when the bin is short", () => {
    expect(binShortfall({ onHand: 6, alreadyDrawn: 0, quantity: 10 })).toBe(4);
  });

  it("counts what earlier rows of the same backflush draw", () => {
    expect(binShortfall({ onHand: 10, alreadyDrawn: 7, quantity: 5 })).toBe(2);
  });

  it("treats a negative bin as empty", () => {
    expect(binShortfall({ onHand: -3, alreadyDrawn: 0, quantity: 2 })).toBe(2);
  });

  it("ignores float noise", () => {
    expect(
      binShortfall({ onHand: 0.3, alreadyDrawn: 0.1, quantity: 0.2 })
    ).toBe(0);
  });
});

describe("summarizeList", () => {
  const parts = Array.from({ length: 120 }, (_, i) => `PART-${i + 1}`);

  it("lists every entry up to the limit", () => {
    expect(summarizeList(["A", "B"])).toBe("A; B");
    expect(summarizeList(parts.slice(0, 5))).toBe(
      "PART-1; PART-2; PART-3; PART-4; PART-5"
    );
  });

  it("names the first entries and counts the rest", () => {
    expect(summarizeList(parts)).toBe(
      "PART-1; PART-2; PART-3; PART-4; PART-5; and 115 more"
    );
    expect(summarizeList(parts, 3)).toBe(
      "PART-1; PART-2; PART-3; and 117 more"
    );
  });

  it("stays short however many entries there are", () => {
    expect(summarizeList(parts).length).toBeLessThan(80);
  });

  it("is empty for no entries", () => {
    expect(summarizeList([])).toBe("");
  });
});

describe("pullFromStorageUnit", () => {
  it("is the line's own bin when nothing was picked", () => {
    expect(pullFromStorageUnit("SHELF-A", [])).toBe("SHELF-A");
  });

  it("is the bin a pick took the line from, once the line points at lineside", () => {
    expect(
      pullFromStorageUnit("LINESIDE", [
        { storageUnitId: "SHELF-A", toStorageUnitId: "LINESIDE" }
      ])
    ).toBe("SHELF-A");
  });

  it("takes the oldest pick: a later list sources from the fullest bin", () => {
    expect(
      pullFromStorageUnit("LINESIDE", [
        { storageUnitId: "SHELF-A", toStorageUnitId: "LINESIDE" },
        { storageUnitId: "SHELF-B", toStorageUnitId: "LINESIDE" }
      ])
    ).toBe("SHELF-A");
  });

  it("ignores picks into another bin, and picks with no source", () => {
    expect(
      pullFromStorageUnit("SHELF-A", [
        { storageUnitId: "SHELF-B", toStorageUnitId: "LINESIDE" },
        { storageUnitId: null, toStorageUnitId: "SHELF-A" },
        { storageUnitId: "SHELF-A", toStorageUnitId: "SHELF-A" }
      ])
    ).toBe("SHELF-A");
  });

  it("is null for a line with no bin", () => {
    expect(
      pullFromStorageUnit(null, [
        { storageUnitId: "SHELF-A", toStorageUnitId: "LINESIDE" }
      ])
    ).toBeNull();
  });
});

describe("strictBackflushLockKey", () => {
  it("is the key SQL backflush_job_materials builds", () => {
    expect(strictBackflushLockKey("CO", "BIN", "ITEM")).toBe(
      "strict-backflush:CO:BIN:ITEM"
    );
  });
});

describe("activationRefusalMessage", () => {
  it("names the parts and caps the list", () => {
    expect(activationRefusalMessage(["PART-1", "PART-2"])).toBe(
      "Set a Pull From storage unit before you activate this version: PART-1; PART-2"
    );
    expect(
      activationRefusalMessage(
        Array.from({ length: 8 }, (_, index) => `PART-${index + 1}`)
      )
    ).toBe(
      "Set a Pull From storage unit before you activate this version: PART-1; PART-2; PART-3; PART-4; PART-5; and 3 more"
    );
  });
});
