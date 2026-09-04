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

describe("custom-field events", () => {
  const update = (
    table: string,
    oldFields: Record<string, unknown> | undefined,
    newFields: Record<string, unknown> | undefined
  ) =>
    computeEventIds({
      table,
      operation: "UPDATE",
      old: { ...base, customFields: oldFields },
      new: { ...base, customFields: newFields }
    });

  it("derives the id from the diff key", () => {
    expect(update("purchaseOrder", { cf_1: "a" }, { cf_1: "b" })).toEqual([
      "purchaseOrder.customFields.cf_1.changed"
    ]);
  });

  it("emits nothing for an untouched custom field", () => {
    expect(update("purchaseOrder", { cf_1: "a" }, { cf_1: "a" })).toEqual([]);
  });

  it("emits one id per changed field", () => {
    expect(
      update(
        "purchaseOrder",
        { cf_1: "a", cf_2: "x" },
        { cf_1: "b", cf_2: "y" }
      )
    ).toEqual([
      "purchaseOrder.customFields.cf_1.changed",
      "purchaseOrder.customFields.cf_2.changed"
    ]);
  });

  // Item custom fields live on the subtypes; the catalog triggers on `item`.
  it("emits nothing for item", () => {
    expect(update("item", { cf_1: "a" }, { cf_1: "b" })).toEqual([]);
  });

  it("puts the watched column's id first when both changed", () => {
    expect(
      computeEventIds({
        table: "purchaseOrder",
        operation: "UPDATE",
        old: { ...base, status: "Draft", customFields: { cf_1: "a" } },
        new: { ...base, status: "Planned", customFields: { cf_1: "b" } }
      })
    ).toEqual([
      "purchaseOrder.status.changed",
      "purchaseOrder.customFields.cf_1.changed"
    ]);
  });
});
