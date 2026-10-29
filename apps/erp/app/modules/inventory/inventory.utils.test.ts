// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isShippableEntityStatus,
  type NonNettableUnit,
  nonNettableSource,
  receivingSearchMatches,
  receivingSearchTerms,
  shippableEntityStatuses,
  writeOffRestoreQuantity
} from "./inventory.utils";

// Shipment tracking, the shipment page and the post modal all read this one
// rule, so a status one accepts the others never refuse.
describe("shippableEntityStatuses", () => {
  it("ships rejected units back to the supplier on a supplier return", () => {
    expect(shippableEntityStatuses("Purchase Return Order")).toEqual([
      "Available",
      "Rejected"
    ]);
    expect(isShippableEntityStatus("Purchase Return Order", "Rejected")).toBe(
      true
    );
    // Units still awaiting inspection stay in the warehouse.
    expect(isShippableEntityStatus("Purchase Return Order", "On Hold")).toBe(
      false
    );
  });

  it("ships returned stock, On Hold, back to the customer on a sales return", () => {
    expect(shippableEntityStatuses("Sales Return Order")).toEqual(["On Hold"]);
    expect(isShippableEntityStatus("Sales Return Order", "Available")).toBe(
      false
    );
  });

  it("ships only Available stock on every other source", () => {
    for (const source of ["Sales Order", "Purchase Order", null, undefined]) {
      expect(shippableEntityStatuses(source)).toEqual(["Available"]);
      expect(isShippableEntityStatus(source, "Rejected")).toBe(false);
    }
    expect(isShippableEntityStatus("Sales Order", null)).toBe(false);
  });
});

// A non-tracked lot an inspection rejected is written off at the reject, so a
// return shipment puts those units back before shipping them — once.
describe("writeOffRestoreQuantity", () => {
  it("puts back every written-off unit the shipment ships", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 2, writtenOff: 2, shippedBefore: 0 })
    ).toBe(2);
  });

  it("puts back no more than the shipment ships", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 1, writtenOff: 3, shippedBefore: 0 })
    ).toBe(1);
  });

  it("leaves out units the line's earlier shipments already put back", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 3, writtenOff: 3, shippedBefore: 1 })
    ).toBe(2);
    expect(
      writeOffRestoreQuantity({ shipped: 2, writtenOff: 3, shippedBefore: 3 })
    ).toBe(0);
  });

  it("puts back only written-off units when the line also returns good stock", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 5, writtenOff: 2, shippedBefore: 0 })
    ).toBe(2);
  });
});

// The Receiving search filters on the view's normalized values and highlights
// with the same rule, so what matched is what is marked.
describe("receivingSearchTerms", () => {
  it("ignores case, spaces and punctuation inside a word", () => {
    expect(receivingSearchTerms("RAB-514")).toEqual(["rab514"]);
    expect(receivingSearchTerms("  Monton   P-0000071.01 ")).toEqual([
      "monton",
      "p000007101"
    ]);
  });

  it("drops words that are only punctuation", () => {
    expect(receivingSearchTerms("- / .")).toEqual([]);
    expect(receivingSearchTerms(null)).toEqual([]);
  });
});

describe("receivingSearchMatches", () => {
  it("marks the original characters a normalized term matched", () => {
    expect(receivingSearchMatches("RAB-514", ["rab514"])).toEqual([[0, 7]]);
    expect(receivingSearchMatches("TI  -200", ["ti200"])).toEqual([[0, 8]]);
  });

  it("merges overlapping matches of several terms", () => {
    expect(
      receivingSearchMatches("BEARING, 7000", ["bear", "ring", "7000"])
    ).toEqual([
      [0, 7],
      [9, 13]
    ]);
  });

  it("marks nothing without a match", () => {
    expect(receivingSearchMatches("MTSV708", ["7000"])).toEqual([]);
  });
});

describe("nonNettableSource", () => {
  const unit = (
    id: string,
    overrides: Partial<NonNettableUnit> = {}
  ): NonNettableUnit => ({
    id,
    name: id,
    parentId: null,
    nettable: true,
    storageTypeIds: [],
    ...overrides
  });
  const units = (...list: NonNettableUnit[]) =>
    new Map(list.map((u) => [u.id, u]));
  const quarantine = new Map([["t-q", "Quarantine"]]);

  it("names the unit's own non-nettable storage type before any parent", () => {
    expect(
      nonNettableSource(
        { parentId: "rack", storageTypeIds: ["t-q"] },
        units(unit("rack", { nettable: false })),
        quarantine
      )
    ).toEqual({ via: "storageType", name: "Quarantine" });
  });

  it("names the nearest non-nettable parent, not a higher one", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: [] },
        units(
          unit("shelf", { parentId: "area", nettable: false }),
          unit("area", { nettable: false })
        ),
        quarantine
      )
    ).toEqual({ via: "parent", name: "shelf" });
  });

  it("names a parent that is non-nettable through its storage type", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: [] },
        units(
          unit("shelf", { parentId: "area" }),
          unit("area", { storageTypeIds: ["t-q"] })
        ),
        quarantine
      )
    ).toEqual({ via: "parent", name: "area" });
  });

  it("finds nothing when every unit above is nettable", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: ["t-other"] },
        units(unit("shelf", { parentId: "area" }), unit("area")),
        quarantine
      )
    ).toBeNull();
  });

  it("stops at a parent it was not given", () => {
    expect(
      nonNettableSource(
        { parentId: "missing", storageTypeIds: [] },
        units(),
        quarantine
      )
    ).toBeNull();
  });
});
