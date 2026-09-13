import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUSH_DEFAULTS,
  parsePushDefaults,
  pushDefaultsEqual
} from "./preferences";

describe("parsePushDefaults", () => {
  it("returns the documented defaults for anything that is not an object", () => {
    for (const value of [null, undefined, "onshape", 7, []]) {
      expect(parsePushDefaults(value)).toEqual(DEFAULT_PUSH_DEFAULTS);
    }
  });

  it("ignores the integration's other metadata keys", () => {
    expect(
      parsePushDefaults({ credentials: { access_token: "x" }, propertyMap: [] })
    ).toEqual(DEFAULT_PUSH_DEFAULTS);
  });

  it("reads a full set of stored preferences", () => {
    expect(
      parsePushDefaults({
        defaultUnitOfMeasureCode: "KG",
        defaultReplenishmentSystem: "Buy and Make",
        defaultMethodTypeForMake: "Pull from Inventory",
        defaultMethodTypeForBuy: "Purchase to Order",
        defaultItemTrackingType: "Serial"
      })
    ).toEqual({
      unitOfMeasureCode: "KG",
      replenishmentSystem: "Buy and Make",
      methodTypeForMake: "Pull from Inventory",
      methodTypeForBuy: "Purchase to Order",
      itemTrackingType: "Serial"
    });
  });

  it("falls back per field, keeping the values that do parse", () => {
    const parsed = parsePushDefaults({
      defaultUnitOfMeasureCode: "   ",
      defaultReplenishmentSystem: "Borrow",
      defaultItemTrackingType: "Serial"
    });
    expect(parsed.unitOfMeasureCode).toBeNull();
    expect(parsed.replenishmentSystem).toBe("Make");
    expect(parsed.itemTrackingType).toBe("Serial");
  });

  it("reconciles a method the replenishment system stopped allowing", () => {
    // Make to Order is not valid for Buy: the two settings are saved
    // independently, so this pair is reachable without any hand-editing.
    const parsed = parsePushDefaults({
      defaultReplenishmentSystem: "Buy",
      defaultMethodTypeForMake: "Make to Order",
      defaultMethodTypeForBuy: "Make to Order"
    });
    expect(parsed.methodTypeForMake).toBe("Pull from Inventory");
    expect(parsed.methodTypeForBuy).toBe("Pull from Inventory");
  });

  it("keeps a method that is still legal for its replenishment system", () => {
    const parsed = parsePushDefaults({
      defaultReplenishmentSystem: "Make",
      defaultMethodTypeForMake: "Make to Order"
    });
    expect(parsed.methodTypeForMake).toBe("Make to Order");
  });
});

describe("pushDefaultsEqual", () => {
  it("is true for the same choices", () => {
    expect(
      pushDefaultsEqual(DEFAULT_PUSH_DEFAULTS, { ...DEFAULT_PUSH_DEFAULTS })
    ).toBe(true);
  });

  it("notices a change in any one field", () => {
    const changes: Array<Partial<typeof DEFAULT_PUSH_DEFAULTS>> = [
      { unitOfMeasureCode: "EA" },
      { replenishmentSystem: "Buy" },
      { methodTypeForMake: "Pull from Inventory" },
      { methodTypeForBuy: "Purchase to Order" },
      { itemTrackingType: "Non-Inventory" }
    ];
    for (const change of changes) {
      expect(
        pushDefaultsEqual(DEFAULT_PUSH_DEFAULTS, {
          ...DEFAULT_PUSH_DEFAULTS,
          ...change
        })
      ).toBe(false);
    }
  });

  it("separates a chosen unit from no unit at all", () => {
    // Null is a real choice — resolve from the company's list at plan time —
    // so it must not compare equal to a code.
    expect(
      pushDefaultsEqual(
        { ...DEFAULT_PUSH_DEFAULTS, unitOfMeasureCode: null },
        { ...DEFAULT_PUSH_DEFAULTS, unitOfMeasureCode: "" }
      )
    ).toBe(false);
  });
});
