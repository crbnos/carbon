// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isShippableEntityStatus,
  shippableEntityStatuses
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
