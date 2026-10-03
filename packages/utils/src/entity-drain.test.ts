// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { settleQuantity, statusAfterQuantityChange } from "./entity-drain";

it("draining to zero Consumes the lot", () => {
  expect(statusAfterQuantityChange(0, "Available")).toEqual("Consumed");
});

it("a positive quantity keeps the current status", () => {
  expect(statusAfterQuantityChange(3, "Available")).toEqual("Available");
  expect(statusAfterQuantityChange(3, "On Hold")).toEqual("On Hold");
  expect(statusAfterQuantityChange(3, "Reserved")).toEqual("Reserved");
});

it("a Scrapped lot stays Scrapped even at zero", () => {
  expect(statusAfterQuantityChange(0, "Scrapped")).toEqual("Scrapped");
  expect(statusAfterQuantityChange(5, "Scrapped")).toEqual("Scrapped");
});

it("a float-residue zero still Consumes", () => {
  // round(1 - 0.98 - 0.02) is exactly 0 → Consumed.
  expect(statusAfterQuantityChange(1 - 0.98 - 0.02, "Available")).toEqual(
    "Consumed"
  );
});

it("settleQuantity: rounds and Consumes a residue drain in one step", () => {
  // The unpick residue case: a child holding 0.020000000000000018 gives back
  // 0.02 — the settled quantity is an exact 0, so the lot is Consumed, not an
  // Available husk holding 1.8e-17.
  expect(
    settleQuantity({
      quantity: 0.020000000000000018 - 0.02,
      status: "Available"
    })
  ).toEqual({ quantity: 0, status: "Consumed" });
});

it("settleQuantity: a surviving remainder keeps its status", () => {
  expect(settleQuantity({ quantity: 1 - 0.98, status: "Available" })).toEqual({
    quantity: 0.02,
    status: "Available"
  });
});

it("settleQuantity: a Scrapped lot stays Scrapped at zero", () => {
  expect(settleQuantity({ quantity: 0, status: "Scrapped" })).toEqual({
    quantity: 0,
    status: "Scrapped"
  });
});

it("settleQuantity: refuses a negative settle rather than clamping", () => {
  expect(() => settleQuantity({ quantity: -0.5, status: "Available" })).toThrow(
    "refusing to write a negative tracked quantity"
  );
  // A caller-supplied refusal wins, so each writer explains its own divergence.
  expect(() =>
    settleQuantity({
      quantity: -1,
      status: "Available",
      refusal: "partial consumption must be unconsumed first"
    })
  ).toThrow("partial consumption must be unconsumed first");
});

it("settleQuantity: float noise below a minor unit is not negative", () => {
  // round(-1e-17) is 0, so this settles instead of refusing.
  expect(settleQuantity({ quantity: -1e-17, status: "Available" })).toEqual({
    quantity: 0,
    status: "Consumed"
  });
});
