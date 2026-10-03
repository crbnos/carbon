// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// sales.models' module graph transitively loads @carbon/content/glossary and
// @carbon/onboarding, both of which build Lingui `msg` descriptors at module
// load. The macro isn't transformed under plain vitest, so raw `msg` throws.
// Stub it to a plain string builder; the validator under test is untouched.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const { quoteLineValidator, quoteValidator, salesOrderLineValidator } =
  await import("./sales.models");

// `quote.internalNotes` is a `json` column that the sales-order conversion
// copies through Kysely. A bare string stored there (which `notes: z.any()`
// allowed from the MCP / API tool) made every conversion of that quote fail
// with `invalid input syntax for type json`. The validator must now turn
// whatever a caller sends into a tiptap document object.

const base = { customerId: "cust_1", locationId: "loc_1" };

describe("quoteValidator.notes", () => {
  it("stores plain-text notes as a tiptap document", () => {
    const parsed = quoteValidator.parse({ ...base, notes: "rush order" });
    expect(parsed.notes).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "rush order" }] }
      ]
    });
  });

  it("keeps a tiptap document as sent", () => {
    const notes = { type: "doc", content: [] };
    expect(quoteValidator.parse({ ...base, notes }).notes).toEqual(notes);
  });

  it("leaves notes undefined when not sent", () => {
    expect(quoteValidator.parse(base).notes).toBeUndefined();
  });

  it("rejects a non-document scalar instead of storing it", () => {
    expect(quoteValidator.safeParse({ ...base, notes: 42 }).success).toBe(
      false
    );
  });
});

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

// quoteLinePrice is keyed by (quoteLineId, quantity), so two equal breaks on a
// line would share one price row and edit together.
describe("quoteLineValidator.quantity", () => {
  it("rejects repeated quantity breaks", () => {
    const result = quoteLineValidator.shape.quantity.safeParse([10, 10, 25]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Each quantity must be different"
    );
  });

  it("accepts distinct quantity breaks", () => {
    expect(
      quoteLineValidator.shape.quantity.safeParse([10, 20, 25]).success
    ).toBe(true);
  });
});
