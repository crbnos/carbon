// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveCountedEntity } from "./inventory.service";

it("applies the delta to the live quantity", () => {
  expect(
    resolveCountedEntity({
      currentQuantity: 10,
      delta: -3,
      currentStatus: "Available"
    })
  ).toEqual({ quantity: 7, status: "Available" });
});

it("landing on exactly zero Consumes the lot", () => {
  expect(
    resolveCountedEntity({
      currentQuantity: 4,
      delta: -4,
      currentStatus: "Available"
    })
  ).toEqual({ quantity: 0, status: "Consumed" });
});

it("a delta that would drive the quantity negative is refused", () => {
  // Stock moved since the snapshot — recount rather than clamp/desync.
  expect(
    resolveCountedEntity({
      currentQuantity: 2,
      delta: -5,
      currentStatus: "Available",
      ledgerTotal: -3
    })
  ).toBeNull();
});

it("a unit whose quantity drifted below its ledger takes the ledger total", () => {
  // Ledger held 22, the unit 0, nothing moved, 0 counted: the ledger is now 0.
  expect(
    resolveCountedEntity({
      currentQuantity: 0,
      delta: -22,
      currentStatus: "Available",
      ledgerTotal: 0
    })
  ).toEqual({ quantity: 0, status: "Consumed" });
  expect(
    resolveCountedEntity({
      currentQuantity: 0,
      delta: -17,
      currentStatus: "Available",
      ledgerTotal: 5
    })
  ).toEqual({ quantity: 5, status: "Available" });
});

it("a Scrapped lot counted to zero stays Scrapped", () => {
  expect(
    resolveCountedEntity({
      currentQuantity: 1,
      delta: -1,
      currentStatus: "Scrapped"
    })
  ).toEqual({ quantity: 0, status: "Scrapped" });
});

it("a Consumed unit takes the ledger total after the count", () => {
  // Issued twice: the ledger held -1; counted 0, the count brings it to 0.
  expect(
    resolveCountedEntity({
      currentQuantity: 0,
      delta: 1,
      currentStatus: "Consumed",
      ledgerTotal: 0
    })
  ).toEqual({ quantity: 0, status: "Consumed" });
  // Found on the shelf: it comes back with what was counted.
  expect(
    resolveCountedEntity({
      currentQuantity: 0,
      delta: 2,
      currentStatus: "Consumed",
      ledgerTotal: 1
    })
  ).toEqual({ quantity: 1, status: "Available" });
  expect(
    resolveCountedEntity({
      currentQuantity: 0,
      delta: 0,
      currentStatus: "Consumed",
      ledgerTotal: -1
    })
  ).toBeNull();
});
