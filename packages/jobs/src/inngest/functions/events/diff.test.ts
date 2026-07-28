import { describe, expect, it } from "vitest";
import { computeDiff } from "./diff";

// Pins the empty-value guard in computeDiff: a form's first save writes ""
// / {} / [] over DB nulls for every untouched field, and those must not
// produce audit noise ("Custom Fields: null → {}", "Tracking Number:
// null → "). Real transitions in or out of a value must keep logging.

describe("computeDiff — empty↔empty transitions are suppressed", () => {
  it("skips null → {} (customFields on first save)", () => {
    expect(
      computeDiff({ customFields: null }, { customFields: {} })
    ).toBeNull();
  });

  it('skips null → "" (untouched text input on first save)', () => {
    expect(
      computeDiff({ trackingNumber: null }, { trackingNumber: "" })
    ).toBeNull();
  });

  it('skips "" → null and {} → null (the reverse direction)', () => {
    expect(computeDiff({ a: "" }, { a: null })).toBeNull();
    expect(computeDiff({ b: {} }, { b: null })).toBeNull();
  });

  it("skips null → [] (array columns like tags)", () => {
    expect(computeDiff({ tags: null }, { tags: [] })).toBeNull();
  });

  it('skips undefined → "" (column absent from the old record)', () => {
    expect(computeDiff({}, { note: "" })).toBeNull();
  });
});

describe("computeDiff — real transitions still log", () => {
  it("logs empty → value (a value being set)", () => {
    expect(
      computeDiff({ trackingNumber: "" }, { trackingNumber: "1234" })
    ).toEqual({ trackingNumber: { old: "", new: "1234" } });
    expect(
      computeDiff({ paymentTermId: null }, { paymentTermId: "pt_1" })
    ).toEqual({ paymentTermId: { old: null, new: "pt_1" } });
  });

  it("logs value → empty (a value being cleared)", () => {
    expect(
      computeDiff({ trackingNumber: "1234" }, { trackingNumber: "" })
    ).toEqual({ trackingNumber: { old: "1234", new: "" } });
  });

  it("logs value → value", () => {
    expect(computeDiff({ status: "Draft" }, { status: "Released" })).toEqual({
      status: { old: "Draft", new: "Released" }
    });
  });

  it("does not treat falsy scalars as empty (0 and false are real values)", () => {
    expect(computeDiff({ qty: null }, { qty: 0 })).toEqual({
      qty: { old: null, new: 0 }
    });
    expect(computeDiff({ active: null }, { active: false })).toEqual({
      active: { old: null, new: false }
    });
  });

  it("suppresses empty↔empty nested keys but keeps real nested changes", () => {
    // customFields is an object on both sides → nested diff path
    expect(
      computeDiff(
        { customFields: { color: null, size: "L" } },
        { customFields: { color: "", size: "XL" } }
      )
    ).toEqual({ "customFields.size": { old: "L", new: "XL" } });
  });

  it("returns null when nothing changed at all", () => {
    expect(computeDiff({ a: 1 }, { a: 1 })).toBeNull();
  });
});
