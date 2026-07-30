import { describe, expect, it, vi } from "vitest";

// accounting.models.ts transitively imports @carbon/glossary, whose Lingui
// `msg` macro is not transformed in the vitest env (same pattern as
// app/utils/query.test.ts). Stub it so the real model barrels can load.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: () => "",
  terms: {}
}));

const { bookAdjustmentRunValidator } = await import("./accounting.models");

// ---------------------------------------------------------------------------
// bookAdjustmentRunValidator — skippedReason is required when status is Skipped
// ---------------------------------------------------------------------------

describe("bookAdjustmentRunValidator", () => {
  const base = {
    bookId: "book-1",
    accountingPeriodId: "period-1",
    generatorKey: "gen-1"
  };

  it("requires a reason when the run is Skipped", () => {
    const result = bookAdjustmentRunValidator.safeParse({
      ...base,
      status: "Skipped"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "skippedReason")
      ).toBe(true);
    }
  });

  it("rejects a whitespace-only skipped reason", () => {
    const result = bookAdjustmentRunValidator.safeParse({
      ...base,
      status: "Skipped",
      skippedReason: "   "
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "skippedReason")
      ).toBe(true);
    }
  });

  it("accepts a non-empty skipped reason", () => {
    const result = bookAdjustmentRunValidator.safeParse({
      ...base,
      status: "Skipped",
      skippedReason: "Superseded by manual entry"
    });
    expect(result.success).toBe(true);
  });

  it("does not require a reason for non-Skipped statuses", () => {
    const result = bookAdjustmentRunValidator.safeParse({
      ...base,
      status: "Posted"
    });
    expect(result.success).toBe(true);
  });
});
