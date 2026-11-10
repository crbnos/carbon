// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  batchPropertyColumnKey,
  batchPropertyColumns,
  batchPropertyFilter,
  batchPropertyValue,
  inventoryCountLineState,
  isShippableEntityStatus,
  type NonNettableUnit,
  nonNettableSource,
  shippableEntityStatuses,
  writeOffRestoreQuantity
} from "./inventory.utils";

// Shipment tracking, the shipment page and the post modal all read this one
// rule, so a status one accepts the others never refuse.
describe("shippableEntityStatuses", () => {
  it("ships rejected units back to the supplier on a supplier return", () => {
    expect(shippableEntityStatuses("Purchase Return Order")).toEqual([
      "Available",
      "Rejected"
    ]);
    expect(isShippableEntityStatus("Purchase Return Order", "Rejected")).toBe(
      true
    );
    // Units still awaiting inspection stay in the warehouse.
    expect(isShippableEntityStatus("Purchase Return Order", "On Hold")).toBe(
      false
    );
  });

  it("ships returned stock (On Hold) and serviced units (Available) back to the customer on a sales return", () => {
    expect(shippableEntityStatuses("Sales Return Order")).toEqual([
      "On Hold",
      "Available"
    ]);
    // A unit that already left on a shipment cannot ship again.
    expect(isShippableEntityStatus("Sales Return Order", "Consumed")).toBe(
      false
    );
  });

  it("ships only Available stock on every other source", () => {
    for (const source of ["Sales Order", "Purchase Order", null, undefined]) {
      expect(shippableEntityStatuses(source)).toEqual(["Available"]);
      expect(isShippableEntityStatus(source, "Rejected")).toBe(false);
    }
    expect(isShippableEntityStatus("Sales Order", null)).toBe(false);
  });
});

// A non-tracked lot an inspection rejected is written off at the reject, so a
// return shipment puts those units back before shipping them — once.
describe("writeOffRestoreQuantity", () => {
  it("puts back every written-off unit the shipment ships", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 2, writtenOff: 2, shippedBefore: 0 })
    ).toBe(2);
  });

  it("puts back no more than the shipment ships", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 1, writtenOff: 3, shippedBefore: 0 })
    ).toBe(1);
  });

  it("leaves out units the line's earlier shipments already put back", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 3, writtenOff: 3, shippedBefore: 1 })
    ).toBe(2);
    expect(
      writeOffRestoreQuantity({ shipped: 2, writtenOff: 3, shippedBefore: 3 })
    ).toBe(0);
  });

  it("puts back only written-off units when the line also returns good stock", () => {
    expect(
      writeOffRestoreQuantity({ shipped: 5, writtenOff: 2, shippedBefore: 0 })
    ).toBe(2);
  });
});

describe("nonNettableSource", () => {
  const unit = (
    id: string,
    overrides: Partial<NonNettableUnit> = {}
  ): NonNettableUnit => ({
    id,
    name: id,
    parentId: null,
    nettable: true,
    storageTypeIds: [],
    ...overrides
  });
  const units = (...list: NonNettableUnit[]) =>
    new Map(list.map((u) => [u.id, u]));
  const quarantine = new Map([["t-q", "Quarantine"]]);

  it("names the unit's own non-nettable storage type before any parent", () => {
    expect(
      nonNettableSource(
        { parentId: "rack", storageTypeIds: ["t-q"] },
        units(unit("rack", { nettable: false })),
        quarantine
      )
    ).toEqual({ via: "storageType", name: "Quarantine" });
  });

  it("names the nearest non-nettable parent, not a higher one", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: [] },
        units(
          unit("shelf", { parentId: "area", nettable: false }),
          unit("area", { nettable: false })
        ),
        quarantine
      )
    ).toEqual({ via: "parent", name: "shelf" });
  });

  it("names a parent that is non-nettable through its storage type", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: [] },
        units(
          unit("shelf", { parentId: "area" }),
          unit("area", { storageTypeIds: ["t-q"] })
        ),
        quarantine
      )
    ).toEqual({ via: "parent", name: "area" });
  });

  it("finds nothing when every unit above is nettable", () => {
    expect(
      nonNettableSource(
        { parentId: "shelf", storageTypeIds: ["t-other"] },
        units(unit("shelf", { parentId: "area" }), unit("area")),
        quarantine
      )
    ).toBeNull();
  });

  it("stops at a parent it was not given", () => {
    expect(
      nonNettableSource(
        { parentId: "missing", storageTypeIds: [] },
        units(),
        quarantine
      )
    ).toBeNull();
  });
});

describe("inventoryCountLineState", () => {
  it("reads a line added while counting as Unexpected", () => {
    expect(
      inventoryCountLineState({ countedQuantity: 1, foundDuringCount: true })
    ).toBe("Unexpected");
  });
  it("reads an uncounted snapshot line as Not counted", () => {
    expect(
      inventoryCountLineState({
        countedQuantity: null,
        foundDuringCount: false
      })
    ).toBe("Not counted");
  });
  it("reads a snapshot line counted 0 as Missing", () => {
    expect(
      inventoryCountLineState({ countedQuantity: 0, foundDuringCount: false })
    ).toBe("Missing");
  });
  it("reads a snapshot line counted above 0 as Found", () => {
    expect(
      inventoryCountLineState({ countedQuantity: 1, foundDuringCount: false })
    ).toBe("Found");
  });
});

describe("batch property columns", () => {
  const property = (
    id: string,
    itemId: string,
    label: string,
    dataType: "text" | "numeric" | "boolean" | "list" | "date" = "text",
    listOptions: string[] | null = null
  ) => ({ id, itemId, label, dataType, listOptions });

  it("gives one column to a label several items share", () => {
    const columns = batchPropertyColumns([
      property("bp1", "AL6061", "Heat number"),
      property("bp2", "SS304", "Heat Number "),
      property("bp3", "SS304", "Mill cert received", "boolean")
    ]);

    expect(columns.map((c) => [c.key, c.label, c.properties])).toEqual([
      [
        "property.heat-number",
        "Heat number",
        [
          { id: "bp1", itemId: "AL6061" },
          { id: "bp2", itemId: "SS304" }
        ]
      ],
      [
        "property.mill-cert-received",
        "Mill cert received",
        [{ id: "bp3", itemId: "SS304" }]
      ]
    ]);
  });

  it("keeps no filter separator in the key", () => {
    expect(
      batchPropertyColumnKey("Melt country (DFARS 252.225-7009): code")
    ).toBe("property.melt-country-dfars-252-225-7009-code");
  });

  it("reads a label whose items disagree on the type as text", () => {
    const [column] = batchPropertyColumns([
      property("bp1", "A", "Grade", "list", ["A", "B"]),
      property("bp2", "B", "Grade", "list", ["B", "C"]),
      property("bp3", "C", "Grade", "numeric")
    ]);

    expect(column.dataType).toBe("text");
    expect(column.listOptions).toEqual(["A", "B", "C"]);
  });

  it("reads the value of the row's own item", () => {
    const [column] = batchPropertyColumns([
      property("bp1", "A", "Heat number"),
      property("bp2", "B", "Heat number")
    ]);

    expect(
      batchPropertyValue(column, {
        itemId: "B",
        attributes: { bp1: "stale", bp2: "H-42" }
      })
    ).toBe("H-42");
    expect(
      batchPropertyValue(column, { itemId: "C", attributes: { bp1: "H-1" } })
    ).toBeUndefined();
  });

  it("filters a value on every item with the label", () => {
    const [column] = batchPropertyColumns([
      property("bp1", "A", "Heat number"),
      property("bp2", "B", "Heat number")
    ]);

    expect(batchPropertyFilter(column, "in", 'H-42,H "7"')).toBe(
      'attributes->>bp1.in.("H-42","H \\"7\\""),attributes->>bp2.in.("H-42","H \\"7\\"")'
    );
  });

  it("finds a yes/no property never set when filtering No", () => {
    const [column] = batchPropertyColumns([
      property("bp1", "A", "Mill cert received", "boolean")
    ]);

    expect(batchPropertyFilter(column, "eq", "false")).toBe(
      'attributes->>bp1.in.("false"),and(itemId.eq."A",attributes->>bp1.is.null)'
    );
    expect(batchPropertyFilter(column, "eq", "true")).toBe(
      'attributes->>bp1.in.("true")'
    );
  });

  it("bounds a date range on either side", () => {
    const [column] = batchPropertyColumns([
      property("bp1", "A", "Formation date", "date")
    ]);

    expect(batchPropertyFilter(column, "between", "2026-01-01,")).toBe(
      'and(attributes->>bp1.gte."2026-01-01")'
    );
  });
});
