// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  finishPickingList,
  kanbanValidator,
  planSerialBoxWrite,
  receiptFixedAssetLineUpdateValidator,
  reconcileReceiptLineSerials,
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
    lineQuantity: 10,
    pickedQuantity: 0
  };

  it("forwards the picker quantity for a batch scan", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "batch",
      quantity: 3
    });
    expect(r).toEqual({ ok: true, quantity: 3 });
  });

  it("posts quantity 1 for a serial scan regardless of the picker quantity", () => {
    const r = resolveStockTransferPickForward({
      ...base,
      transferType: "serial",
      quantity: 4
    });
    expect(r).toEqual({ ok: true, quantity: 1 });
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

  it("refuses a decimal quantity with a readable message", () => {
    const r = kanbanValidator.safeParse({ ...transfer, quantity: "2.5" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((issue) => issue.message)).toContain(
        "Quantity must be a whole number"
      );
    }
  });

  it("refuses a negative level", () => {
    const r = kanbanValidator.safeParse({
      ...transfer,
      replenishmentLevel: "-1"
    });
    expect(errorPaths(r)).toContain("replenishmentLevel");
  });
});

describe("planSerialBoxWrite", () => {
  const box = (line: string, index: number) => ({
    "Receipt Line": line,
    "Receipt Line Index": index,
    Receipt: "rec1"
  });

  it("clears the box when the serial is emptied", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "  ",
        box: [{ id: "e1", hasHistory: false }],
        withSerial: []
      })
    ).toEqual({ kind: "clear", releaseIds: ["e1"] });
  });

  it("renames the box's own entity when the serial is edited", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "NEW",
        box: [{ id: "e1", hasHistory: false }],
        withSerial: []
      })
    ).toEqual({ kind: "write", targetId: "e1", releaseIds: [] });
  });

  it("refuses a serial held by another box and empties this one", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 1,
        serialNumber: "SN-A",
        box: [{ id: "e2", hasHistory: false }],
        withSerial: [
          { id: "e1", hasHistory: false, attributes: box("line1", 0) }
        ]
      })
    ).toEqual({ kind: "taken", reason: "box", releaseIds: ["e2"] });
  });

  it("refuses a serial held by a box on another receipt line", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-A",
        box: [],
        withSerial: [
          { id: "e9", hasHistory: false, attributes: box("line2", 0) }
        ]
      }).kind
    ).toBe("taken");
  });

  it("keeps one copy when a racing save left two in the box", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-A",
        box: [
          { id: "e1", hasHistory: false },
          { id: "e2", hasHistory: false }
        ],
        withSerial: [
          { id: "e1", hasHistory: false, attributes: box("line1", 0) },
          { id: "e2", hasHistory: false, attributes: box("line1", 0) }
        ]
      })
    ).toEqual({ kind: "write", targetId: "e1", releaseIds: ["e2"] });
  });

  it("never renames a box entity that has stock history", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "NEW",
        box: [{ id: "unit", hasHistory: true }],
        withSerial: []
      })
    ).toEqual({ kind: "write", targetId: undefined, releaseIds: ["unit"] });
  });

  it("refuses the serial of a unit with stock history", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-B",
        box: [{ id: "e1", hasHistory: false }],
        withSerial: [
          { id: "shipped", hasHistory: true, attributes: { Shipment: "sh1" } }
        ]
      })
    ).toEqual({ kind: "taken", reason: "unit", releaseIds: ["e1"] });
  });

  it("refuses a unit with stock history even when it already sits in the box", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-B",
        box: [{ id: "shipped", hasHistory: true }],
        withSerial: [
          { id: "shipped", hasHistory: true, attributes: box("line1", 0) }
        ]
      })
    ).toEqual({ kind: "taken", reason: "unit", releaseIds: ["shipped"] });
  });

  it("takes back the serial of a voided receipt as the same unit", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-A",
        box: [],
        withSerial: [
          {
            id: "voided",
            hasHistory: false,
            attributes: { ...box("lineOld", 0), Receipt: "recVoided" },
            onVoidedReceipt: true
          }
        ]
      })
    ).toEqual({ kind: "write", targetId: "voided", releaseIds: [] });
  });

  it("refuses the serial of a record no receipt box holds (a job's reserved serial)", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-A",
        box: [{ id: "e1", hasHistory: false }],
        withSerial: [
          { id: "reserved", hasHistory: false, attributes: { Job: "job1" } }
        ]
      })
    ).toEqual({ kind: "taken", reason: "unit", releaseIds: ["e1"] });
  });

  it("names a received unit in another box as an existing unit", () => {
    expect(
      planSerialBoxWrite({
        receiptLineId: "line1",
        index: 0,
        serialNumber: "SN-B",
        box: [],
        withSerial: [
          { id: "received", hasHistory: true, attributes: box("line2", 0) }
        ]
      })
    ).toEqual({ kind: "taken", reason: "unit", releaseIds: [] });
  });
});

describe("reconcileReceiptLineSerials", () => {
  it("reports an index with no serial as missing", () => {
    expect(
      reconcileReceiptLineSerials(
        [
          { id: "a", index: 0, hasSerial: true },
          { id: "c", index: 2, hasSerial: true }
        ],
        3
      ).missingIndexes
    ).toEqual([1]);
  });

  it("marks the boxes beyond the received quantity as surplus", () => {
    expect(
      reconcileReceiptLineSerials(
        [
          { id: "a", index: 0, hasSerial: true },
          { id: "c", index: 2, hasSerial: true }
        ],
        2
      ).surplusEntityIds
    ).toEqual(["c"]);
  });

  it("keeps the serial-bearing entity over an older blank one", () => {
    expect(
      reconcileReceiptLineSerials(
        [
          { id: "blank", index: 0, hasSerial: false, createdAt: "1" },
          { id: "serial", index: 0, hasSerial: true, createdAt: "2" }
        ],
        1
      )
    ).toEqual({ missingIndexes: [], surplusEntityIds: ["blank"] });
  });
});

describe("finishPickingList", () => {
  const finish = (
    unresolvedItemNames: string[],
    opts: { hasShort?: boolean; policy?: string; acknowledged?: boolean } = {}
  ) =>
    finishPickingList({
      unresolvedItemNames,
      hasShort: opts.hasShort ?? false,
      policy: opts.policy ?? "warn",
      acknowledged: opts.acknowledged ?? false
    });

  it("completes a list with every line picked", () => {
    expect(finish([])).toEqual({ outcome: "finish", status: "Completed" });
  });

  it("finishes a list with a short line as Partial", () => {
    expect(finish([], { hasShort: true })).toEqual({
      outcome: "finish",
      status: "Partial"
    });
  });

  it("refuses unpicked lines under the error policy, even acknowledged", () => {
    expect(
      finish(["Bolt", "Nut"], { policy: "error", acknowledged: true })
    ).toEqual({
      outcome: "refuse",
      message: "Can't finish — still unpicked: Bolt, Nut"
    });
  });

  it("asks before finishing unpicked lines under warn, then finishes Partial", () => {
    expect(finish(["Bolt"])).toEqual({ outcome: "ask" });
    expect(finish(["Bolt"], { acknowledged: true })).toEqual({
      outcome: "finish",
      status: "Partial"
    });
  });
});
