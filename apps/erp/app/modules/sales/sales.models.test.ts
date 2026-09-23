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

const {
  quoteValidator,
  rentalAgreementChargeValidator,
  salesOrderLineValidator
} = await import("./sales.models");

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

// A service period on a line is either absent or a complete, ordered pair:
// revenue recognition schedules from it, so a lone start or an end before the
// start must be refused at validation rather than stored.

const lineBase = {
  salesOrderId: "so_1",
  salesOrderLineType: "Part" as const,
  itemId: "item_1",
  locationId: "loc_1",
  methodType: "Make to Order" as const,
  taxPercent: 0
};

describe("salesOrderLineValidator service dates", () => {
  it("rejects a service end before the service start", () => {
    const result = salesOrderLineValidator.safeParse({
      ...lineBase,
      serviceStartDate: "2026-03-01",
      serviceEndDate: "2026-02-01"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["serviceEndDate"]);
      expect(result.error.issues[0]?.message).toBe(
        "Service end must be on or after service start"
      );
    }
  });

  it("rejects a service start without a service end", () => {
    expect(
      salesOrderLineValidator.safeParse({
        ...lineBase,
        serviceStartDate: "2026-03-01"
      }).success
    ).toBe(false);
  });

  it("accepts a service start and end in order", () => {
    const parsed = salesOrderLineValidator.parse({
      ...lineBase,
      serviceStartDate: "2026-03-01",
      serviceEndDate: "2026-03-31"
    });
    expect(parsed.serviceStartDate).toBe("2026-03-01");
    expect(parsed.serviceEndDate).toBe("2026-03-31");
  });

  it("accepts a line with no service period", () => {
    expect(salesOrderLineValidator.safeParse(lineBase).success).toBe(true);
  });
});

// A charge's kind is never the caller's: `Rent` is billed from the schedule and
// `Purchase Option` only by Sell to Customer, whose guards a posted kind would
// skip. The form validator must not carry one through.
describe("rentalAgreementChargeValidator", () => {
  it("drops a posted kind", () => {
    const result = rentalAgreementChargeValidator.safeParse({
      rentalAgreementLineId: "ral_1",
      kind: "Purchase Option",
      chargeDate: "2026-09-23",
      description: "Damage",
      amount: "100",
      taxPercent: "0"
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("kind");
  });
});
