import { describe, expect, it } from "vitest";
import {
  resolveStockTransferPickForward,
  storageTypeValidator,
  storageUnitValidator
} from "./inventory.models";

describe("storageTypeValidator", () => {
  it("trims surrounding whitespace from the name", () => {
    const r = storageTypeValidator.safeParse({ name: "  Pallet  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Pallet");
  });

  it("rejects a name that is only whitespace", () => {
    const r = storageTypeValidator.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });
});

describe("storageUnitValidator", () => {
  it("trims surrounding whitespace from the name", () => {
    const r = storageUnitValidator.safeParse({
      name: "Rack A1 ",
      locationId: "loc1"
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Rack A1");
  });

  it("rejects a name that is only whitespace", () => {
    const r = storageUnitValidator.safeParse({
      name: " ",
      locationId: "loc1"
    });
    expect(r.success).toBe(false);
  });
});

describe("resolveStockTransferPickForward", () => {
  const base = {
    storageUnitId: "bin-chosen" as string | null,
    currentStorageUnitId: "bin-default" as string | null,
    lineQuantity: 10,
    pickedQuantity: 0
  };

  it("forwards the picker quantity and chosen bin for a batch scan", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 3
    });
    expect(r).toEqual({
      ok: true,
      quantity: 3,
      fromStorageUnitId: "bin-chosen"
    });
  });

  it("posts quantity 1 for a serial scan regardless of the picker quantity", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "serial",
      quantity: 4
    });
    expect(r).toEqual({
      ok: true,
      quantity: 1,
      fromStorageUnitId: "bin-chosen"
    });
  });

  it("falls back to the highest-quantity bin when the picker sends none", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 3,
      storageUnitId: null
    });
    expect(r.ok && r.fromStorageUnitId).toBe("bin-default");
  });

  it("refuses a pick on a fully-picked line", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 1,
      pickedQuantity: 10
    });
    expect(r).toEqual({
      ok: false,
      message: "This line is already fully picked"
    });
  });

  it("names the outstanding quantity when a batch pick exceeds it", () => {
    // Not "already fully picked" — there are 5 left, the operator asked for 8.
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 8,
      pickedQuantity: 5
    });
    expect(r).toEqual({
      ok: false,
      message: "Only 5 left to pick on this line"
    });
  });

  it("refuses a batch pick that rounds to nothing", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 0.000001
    });
    expect(r).toEqual({ ok: false, message: "Enter a quantity to pick" });
  });

  it("allows an equal-at-scale full pick (0.98 + 0.02)", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 1 - 0.98,
      lineQuantity: 1,
      pickedQuantity: 0.98
    });
    expect(r.ok).toBe(true);
  });
});
