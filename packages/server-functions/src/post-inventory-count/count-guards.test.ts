// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveCountedEntity } from "./count-guards";

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
  expect(() =>
    resolveCountedEntity({
      currentQuantity: 2,
      delta: -5,
      currentStatus: "Available"
    })
  ).toThrow();
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
