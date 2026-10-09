// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  kanbanValidator,
  receiptFixedAssetLineUpdateValidator,
  resolveStockTransferPickForward,
  shipmentFixedAssetLineUpdateValidator,
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

describe("shipmentFixedAssetLineUpdateValidator", () => {
  it("rejects a negative meter reading", () => {
    const r = shipmentFixedAssetLineUpdateValidator.safeParse({
      id: "sfal1",
      field: "meter",
      value: "-1"
    });
    expect(r.success).toBe(false);
  });

  it("accepts an empty or a positive meter reading", () => {
    for (const value of ["", "120"]) {
      const r = shipmentFixedAssetLineUpdateValidator.safeParse({
        id: "sfal1",
        field: "meter",
        value
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown field", () => {
    const r = shipmentFixedAssetLineUpdateValidator.safeParse({
      id: "sfal1",
      field: "notes",
      value: "scratched"
    });
    expect(r.success).toBe(false);
  });
});

describe("receiptFixedAssetLineUpdateValidator", () => {
  it("rejects a negative meter reading", () => {
    const r = receiptFixedAssetLineUpdateValidator.safeParse({
      id: "rfal1",
      field: "meter",
      value: "-1"
    });
    expect(r.success).toBe(false);
  });

  it("accepts an empty or a positive meter reading", () => {
    for (const value of ["", "120"]) {
      const r = receiptFixedAssetLineUpdateValidator.safeParse({
        id: "rfal1",
        field: "meter",
        value
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown field", () => {
    const r = receiptFixedAssetLineUpdateValidator.safeParse({
      id: "rfal1",
      field: "shipped",
      value: "true"
    });
    expect(r.success).toBe(false);
  });
});

describe("kanbanValidator replenishmentLevel", () => {
  const transfer = {
    itemId: "item-1",
    replenishmentSystem: "Transfer",
    quantity: "5",
    locationId: "loc-1",
    fromStorageUnitId: "su-a",
    storageUnitId: "su-b"
  };

  const errorPaths = (r: ReturnType<typeof kanbanValidator.safeParse>) =>
    r.success ? [] : r.error.issues.map((issue) => issue.path.join("."));

  it("accepts a level on a Transfer kanban", () => {
    const r = kanbanValidator.safeParse({
      ...transfer,
      replenishmentLevel: "10"
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replenishmentLevel).toBe(10);
  });

  it("accepts a Transfer kanban with no level (scan-only)", () => {
    const r = kanbanValidator.safeParse(transfer);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replenishmentLevel).toBeUndefined();
  });

  it("refuses a level on a Buy kanban", () => {
    const r = kanbanValidator.safeParse({
      itemId: "item-1",
      replenishmentSystem: "Buy",
      quantity: "5",
      locationId: "loc-1",
      supplierId: "sup-1",
      replenishmentLevel: "10"
    });
    expect(errorPaths(r)).toContain("replenishmentLevel");
  });

  it("refuses a negative level", () => {
    const r = kanbanValidator.safeParse({
      ...transfer,
      replenishmentLevel: "-1"
    });
    expect(errorPaths(r)).toContain("replenishmentLevel");
  });
});
