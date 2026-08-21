import { describe, expect, it } from "vitest";
import {
  describeOnshapeReplenishment,
  readOnshapePurchasingLevel,
  resolveOnshapeReplenishment
} from "./onshape-replenishment";

// Buy-vs-Make is the field Onshape cannot supply from geometry and the one
// Carbon most needs right: methodMaterial.methodType is denormalized from the
// component's defaultMethodType, so a subassembly minted Buy silently stops its
// nested BOM exploding, and a purchased leaf minted Make has MRP plan to build
// something the shop buys. Both are invisible until a planner notices.
//
// The precedence is pinned here because the two paths that create parts — the
// BOM import and the release mint — must reach the SAME answer for the same
// part, or which door it came through decides how it plans.

describe("readOnshapePurchasingLevel", () => {
  it("reads the column the legacy integration reads", () => {
    expect(
      readOnshapePurchasingLevel({ "Purchasing Level": "Purchased" })
    ).toBe("Purchased");
  });

  it("is forgiving about case and whitespace", () => {
    // The column is COMPANY-DEFINED, so there is no stable stock propertyId to
    // key on and the display name is all there is. Being exact about the name
    // buys nothing when the name itself is the fragile part.
    expect(
      readOnshapePurchasingLevel({ "  purchasing level ": " Purchased " })
    ).toBe("Purchased");
  });

  it("returns null when the company has not defined the column", () => {
    // The normal case. Verified live 2026-08-21: the column is in neither the
    // 26 stock BOM columns nor the 19 stock element metadata properties.
    expect(
      readOnshapePurchasingLevel({
        "Part number": "EL-402",
        Revision: "A",
        Vendor: ""
      })
    ).toBeNull();
    expect(readOnshapePurchasingLevel(null)).toBeNull();
    expect(readOnshapePurchasingLevel({})).toBeNull();
  });

  it("treats an empty value as absent", () => {
    expect(
      readOnshapePurchasingLevel({ "Purchasing Level": "   " })
    ).toBeNull();
  });
});

describe("resolveOnshapeReplenishment", () => {
  it("follows Onshape when it says Purchased", () => {
    expect(
      resolveOnshapeReplenishment({
        purchasingLevel: "Purchased",
        hasChildren: true
      })
    ).toEqual({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      source: "purchasing-level"
    });
  });

  it("lets Onshape override the structural guess in BOTH directions", () => {
    // A leaf the company has declared as made in-house.
    expect(
      resolveOnshapeReplenishment({
        purchasingLevel: "Manufactured",
        hasChildren: false
      }).replenishmentSystem
    ).toBe("Make");
    // An assembly the company buys as a unit.
    expect(
      resolveOnshapeReplenishment({
        purchasingLevel: "Purchased",
        elementType: 1
      }).replenishmentSystem
    ).toBe("Buy");
  });

  it("keeps legacy's semantics: anything that is not Purchased is made", () => {
    for (const value of ["Manufactured", "Made", "In-house", "Assembly"]) {
      expect(
        resolveOnshapeReplenishment({ purchasingLevel: value })
          .replenishmentSystem
      ).toBe("Make");
    }
  });

  it("matches Purchased case-insensitively", () => {
    expect(
      resolveOnshapeReplenishment({ purchasingLevel: "purchased" })
        .replenishmentSystem
    ).toBe("Buy");
  });

  it("falls to STRUCTURE when the column is absent, never to blanket Make", () => {
    // This is the whole difference from legacy. Legacy's `else` branch calls
    // every part Make when the column does not exist — which is every company
    // that has not defined it — and that poisons MRP for purchased leaves.
    expect(resolveOnshapeReplenishment({ hasChildren: false })).toEqual({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      source: "structure"
    });
    expect(
      resolveOnshapeReplenishment({ hasChildren: true }).replenishmentSystem
    ).toBe("Make");
  });

  it("uses the element type on the release path, where there is no tree", () => {
    expect(
      resolveOnshapeReplenishment({ elementType: 1 }).replenishmentSystem
    ).toBe("Make");
    expect(
      resolveOnshapeReplenishment({ elementType: 0 }).replenishmentSystem
    ).toBe("Buy");
    // An unrecognised type falls to Buy: the safer wrong answer, since it does
    // not claim Carbon can build something it has no method for.
    expect(
      resolveOnshapeReplenishment({ elementType: 99 }).replenishmentSystem
    ).toBe("Buy");
  });

  it("prefers hasChildren over elementType when both are supplied", () => {
    // The BOM path knows the real tree; the element type is a proxy for it.
    expect(
      resolveOnshapeReplenishment({ hasChildren: false, elementType: 1 })
        .replenishmentSystem
    ).toBe("Buy");
  });

  it("never pairs Make with Pull from Inventory", () => {
    // get_method_tree only resolves a sub-method for "Pull from Inventory" or a
    // non-null materialMakeMethodId, so a Make part whose method type says Pull
    // from Inventory silently terminates the BOM recursion.
    const inputs = [
      { purchasingLevel: "Purchased" },
      { purchasingLevel: "Made" },
      { hasChildren: true },
      { hasChildren: false },
      { elementType: 0 },
      { elementType: 1 }
    ];
    for (const input of inputs) {
      const resolved = resolveOnshapeReplenishment(input);
      expect(resolved.replenishmentSystem === "Make").toBe(
        resolved.defaultMethodType === "Make to Order"
      );
    }
  });
});

describe("describeOnshapeReplenishment", () => {
  it("says Onshape decided it when Onshape decided it", () => {
    const message = describeOnshapeReplenishment(
      "EL-402",
      resolveOnshapeReplenishment({ purchasingLevel: "Purchased" })
    );
    expect(message).toContain("EL-402");
    expect(message).toContain("Purchasing Level");
    expect(message).not.toContain("ASSUMED");
  });

  it("says ASSUMED when Carbon guessed from structure", () => {
    // "Onshape told us" and "we inferred it from the shape of the tree" warrant
    // very different trust from whoever reads the notification.
    const message = describeOnshapeReplenishment(
      "RD-410",
      resolveOnshapeReplenishment({ elementType: 1 })
    );
    expect(message).toContain("ASSUMED");
    expect(message).toContain("no bill of materials");
  });
});
