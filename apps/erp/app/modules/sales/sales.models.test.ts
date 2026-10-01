// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// sales.models' module graph builds Lingui `msg` descriptors at load (the
// glossary), and the macro isn't transformed under plain vitest — the same
// stub resources.models.test.ts uses. The validator under test is untouched.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

import { salesOrderLineValidator } from "./sales.models";

describe("salesOrderLineValidator priceTrace", () => {
  const line = {
    salesOrderId: "so1",
    salesOrderLineType: "Part",
    itemId: "item1",
    methodType: "Pull from Inventory",
    locationId: "loc1",
    taxPercent: "0"
  };
  const trace = [
    { step: "Base Price", source: "Item Unit Sale Price", amount: 100 },
    { step: "Final Price", source: "Resolved", amount: 100 }
  ];

  const parse = (priceTrace?: string) =>
    salesOrderLineValidator.parse(
      priceTrace === undefined ? line : { ...line, priceTrace }
    ).priceTrace;

  it("keeps a posted trace", () => {
    expect(parse(JSON.stringify(trace))).toEqual(trace);
  });

  it('clears the trace when "null" is posted for a typed price', () => {
    expect(parse("null")).toBeNull();
  });

  it("leaves the stored trace alone when the field is not posted", () => {
    expect(parse()).toBeUndefined();
  });

  it("rejects a trace that is not a list of steps", () => {
    expect(() => parse(JSON.stringify({ step: "Base Price" }))).toThrow();
  });
});
