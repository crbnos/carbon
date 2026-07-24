import { describe, expect, it, vi } from "vitest";

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform. settings.models.ts pulls it in transitively
// via @carbon/documents/template; nothing under test touches the glossary, so
// stub the whole package (same mock as accounting.periods.test.ts).
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

const { purchaseOrderPricePrecisionValidator } = await import(
  "./settings.models"
);

describe("purchaseOrderPricePrecisionValidator", () => {
  it.each([2, 3, 4])("accepts %i as a valid precision", (precision) => {
    const result = purchaseOrderPricePrecisionValidator.safeParse({
      purchaseOrderPricePrecision: precision
    });

    expect(result.success).toBe(true);
  });

  it.each([1, 5, 0, -2])("rejects %i as an invalid precision", (precision) => {
    const result = purchaseOrderPricePrecisionValidator.safeParse({
      purchaseOrderPricePrecision: precision
    });

    expect(result.success).toBe(false);
  });
});
