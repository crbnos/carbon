import { describe, expect, it } from "vitest";
import { mintDefaultsForRelease } from "./onshape-mint";

// These four fields decide what MRP does with a part nobody chose to create.
// Getting them wrong is not cosmetic: a purchased leaf minted Make means MRP
// plans to build something the shop buys, and it is invisible until a planner
// notices. The rule is pinned here so it cannot drift from the BOM import's,
// which is the same decision reached from the same signal.

describe("mintDefaultsForRelease", () => {
  it("treats a released ASSEMBLY as made in-house", () => {
    const defaults = mintDefaultsForRelease({
      elementType: 1,
      partNumber: "RD-410"
    });

    expect(defaults.replenishmentSystem).toBe("Make");
    expect(defaults.defaultMethodType).toBe("Make to Order");
  });

  it("treats a released PART STUDIO body as purchased", () => {
    const defaults = mintDefaultsForRelease({
      elementType: 0,
      partNumber: "EL-402"
    });

    expect(defaults.replenishmentSystem).toBe("Buy");
    expect(defaults.defaultMethodType).toBe("Pull from Inventory");
  });

  it("matches the BOM import's rule: Make implies Make to Order, never a mix", () => {
    // methodMaterial.methodType is DENORMALIZED from defaultMethodType, and
    // get_method_tree only resolves a sub-method for "Pull from Inventory" or a
    // non-null materialMakeMethodId. A Make part whose method type says Pull
    // from Inventory silently terminates the BOM recursion.
    for (const elementType of [0, 1]) {
      const defaults = mintDefaultsForRelease({
        elementType,
        partNumber: "X"
      });
      expect(defaults.replenishmentSystem === "Make").toBe(
        defaults.defaultMethodType === "Make to Order"
      );
    }
  });

  it("takes Carbon's own defaults for what Onshape does not say", () => {
    const defaults = mintDefaultsForRelease({
      elementType: 1,
      partNumber: "RD-410"
    });

    expect(defaults.itemTrackingType).toBe("Inventory");
    expect(defaults.unitOfMeasureCode).toBe("EA");
  });

  it("follows Onshape's Purchasing Level over the element type", () => {
    // The column the LEGACY integration reads. It is the only place an engineer
    // states the intent rather than implying it, so it outranks the structural
    // guess in both directions.
    expect(
      mintDefaultsForRelease({
        elementType: 1,
        partNumber: "RD-410",
        purchasingLevel: "Purchased"
      }).replenishmentSystem
    ).toBe("Buy");
    expect(
      mintDefaultsForRelease({
        elementType: 0,
        partNumber: "EL-402",
        purchasingLevel: "Manufactured"
      }).replenishmentSystem
    ).toBe("Make");
  });

  it("reports WHICH source decided it", () => {
    expect(
      mintDefaultsForRelease({
        elementType: 1,
        partNumber: "RD-410",
        purchasingLevel: "Purchased"
      }).replenishmentSource
    ).toBe("purchasing-level");
    expect(
      mintDefaultsForRelease({ elementType: 1, partNumber: "RD-410" })
        .replenishmentSource
    ).toBe("structure");
  });

  it("always names the part and what was assumed", () => {
    // The assumption is the mitigation for guessing at all — it has to be
    // readable and specific, because it is what a person acts on.
    const assembly = mintDefaultsForRelease({
      elementType: 1,
      partNumber: "RD-410"
    }).assumption;
    expect(assembly).toContain("RD-410");
    expect(assembly).toContain("Make");
    expect(assembly).toContain("no bill of materials");

    const part = mintDefaultsForRelease({
      elementType: 0,
      partNumber: "EL-402"
    }).assumption;
    expect(part).toContain("EL-402");
    expect(part).toContain("purchased");
  });

  it("treats an unknown element type as a leaf, not an assembly", () => {
    // Buy is the safer wrong answer: it does not claim Carbon can build
    // something it has no method for.
    expect(
      mintDefaultsForRelease({ elementType: 99, partNumber: "X" })
        .replenishmentSystem
    ).toBe("Buy");
  });
});
