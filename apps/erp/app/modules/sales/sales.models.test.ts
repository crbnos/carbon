import { describe, expect, it, vi } from "vitest";

// sales.models' module graph transitively loads @carbon/glossary and
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

const { quoteValidator } = await import("./sales.models");

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
