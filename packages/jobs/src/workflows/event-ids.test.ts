import { describe, expect, it } from "vitest";
import { computeEventIds } from "./event-ids";

const base = {
  id: "po_1",
  companyId: "co_1",
  status: "Draft",
  supplierId: "sup_1",
  notes: "before",
  updatedAt: "2026-07-30T00:00:00.000Z",
  updatedBy: "usr_1"
};

describe("computeEventIds", () => {
  it("maps an INSERT to the table's created event", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "INSERT",
        old: null,
        new: base
      })
    ).toEqual(["purchaseOrder.created"]);
  });

  it("maps a DELETE to the table's deleted event", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "DELETE",
        old: base,
        new: null
      })
    ).toEqual(["purchaseOrder.deleted"]);
  });

  it("returns nothing when an UPDATE touches no watched column", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "UPDATE",
        old: base,
        new: { ...base, notes: "after" }
      })
    ).toEqual([]);
  });

  it("returns every changed watched column, in catalog order", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "UPDATE",
        old: base,
        new: { ...base, status: "To Review", supplierId: "sup_2" }
      })
    ).toEqual([
      "purchaseOrder.status.changed",
      "purchaseOrder.supplierId.changed"
    ]);
  });

  it("returns nothing when only skip-fields differ", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "UPDATE",
        old: base,
        new: {
          ...base,
          updatedAt: "2026-07-31T00:00:00.000Z",
          updatedBy: "usr_2"
        }
      })
    ).toEqual([]);
  });

  it("returns nothing for a table with no catalog events", () => {
    expect(
      computeEventIds({
        table: "notARealTable",
        operation: "INSERT",
        old: null,
        new: { id: "x", companyId: "co_1" }
      })
    ).toEqual([]);
  });
});
