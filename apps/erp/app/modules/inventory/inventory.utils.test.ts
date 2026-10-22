// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isShippableEntityStatus,
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
