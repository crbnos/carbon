import { describe, expect, it } from "vitest";
import { bomOptionState, seedFromElementType } from "./onshapePartSource";

describe("seedFromElementType", () => {
  it("classifies an assembly as Make / Make to Order", () => {
    expect(seedFromElementType(1)).toEqual({
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order"
    });
  });

  it("classifies a Part Studio body as Buy / Pull from Inventory", () => {
    expect(seedFromElementType(0)).toEqual({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory"
    });
  });

  it("treats anything that is not an assembly as a part", () => {
    // A drawing never reaches the picker, but the rule must not fall through to
    // "Make" for an element type nobody anticipated.
    expect(seedFromElementType(2).replenishmentSystem).toBe("Buy");
  });
});

describe("bomOptionState", () => {
  const all = { canCreate: true, canUpdate: true, canDelete: true };

  it("does not offer the option for a Part Studio body", () => {
    // A body has no bill of materials — offering the choice would be offering
    // one that cannot work.
    expect(bomOptionState({ elementType: 0, ...all })).toEqual({
      offered: false,
      disabled: true,
      reason: null
    });
  });

  it("enables the option for an assembly with create + update + delete", () => {
    expect(bomOptionState({ elementType: 1, ...all })).toEqual({
      offered: true,
      disabled: false,
      reason: null
    });
  });

  it("offers but disables the option when delete is missing", () => {
    // The import DELETES material lines, so `delete` is not optional — and the
    // user must see why before the part is created, not after.
    expect(
      bomOptionState({
        elementType: 1,
        canCreate: true,
        canUpdate: true,
        canDelete: false
      })
    ).toEqual({
      offered: true,
      disabled: true,
      reason: "missing-permissions"
    });
  });

  it("offers but disables the option when update is missing", () => {
    expect(
      bomOptionState({
        elementType: 1,
        canCreate: true,
        canUpdate: false,
        canDelete: true
      })
    ).toEqual({
      offered: true,
      disabled: true,
      reason: "missing-permissions"
    });
  });

  it("offers but disables the option for a create-only user", () => {
    expect(
      bomOptionState({
        elementType: 1,
        canCreate: true,
        canUpdate: false,
        canDelete: false
      }).disabled
    ).toBe(true);
  });
});
