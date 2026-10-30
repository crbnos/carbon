// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type CountImportItem,
  type CountImportLine,
  planInventoryCountImport
} from "./inventory.service";
import { parseInventoryCountCsv } from "./inventory.utils";

const items: CountImportItem[] = [
  {
    id: "ser",
    readableId: "SER",
    readableIdWithRevision: "SER",
    itemTrackingType: "Serial"
  },
  {
    id: "bat",
    readableId: "BAT",
    readableIdWithRevision: "BAT",
    itemTrackingType: "Batch"
  },
  {
    id: "inv",
    readableId: "INV",
    readableIdWithRevision: "INV",
    itemTrackingType: "Inventory"
  }
];
const storageUnits = [
  { id: "A1", name: "A1" },
  { id: "B2", name: "B2" }
];
const entities = [
  { id: "e1", itemId: "ser", readableId: "SN-1" },
  { id: "e2", itemId: "ser", readableId: "SN-2" },
  { id: "e3", itemId: "ser", readableId: "SN-3" },
  { id: "l1", itemId: "bat", readableId: "LOT-1" }
];
const line = (overrides: Partial<CountImportLine>): CountImportLine => ({
  id: "x",
  itemId: "ser",
  storageUnitId: "A1",
  trackedEntityId: null,
  readableId: null,
  foundDuringCount: false,
  unnumberedSince: null,
  ...overrides
});
const lines: CountImportLine[] = [
  line({ id: "ln1", trackedEntityId: "e1", readableId: "SN-1" }),
  line({ id: "ln2", trackedEntityId: "e2", readableId: "SN-2" }),
  line({
    id: "ln3",
    storageUnitId: "B2",
    trackedEntityId: "e3",
    readableId: "SN-3"
  }),
  line({
    id: "lnL",
    itemId: "bat",
    trackedEntityId: "l1",
    readableId: "LOT-1"
  }),
  line({ id: "lnI", itemId: "inv" }),
  line({
    id: "u1",
    storageUnitId: "B2",
    trackedEntityId: "n1",
    unnumberedSince: "2026-01-01"
  }),
  line({
    id: "u2",
    storageUnitId: "B2",
    trackedEntityId: "n2",
    unnumberedSince: "2026-01-02"
  })
];
const row = (
  n: number,
  item: string,
  storageUnit: string,
  code: string,
  quantity: number
) => ({
  line: n,
  item,
  storageUnit,
  code,
  quantity
});
const plan = (rows: ReturnType<typeof row>[]) =>
  planInventoryCountImport({ rows, items, storageUnits, entities, lines });

describe("parseInventoryCountCsv", () => {
  it("reads the 4 columns in any order and skips rows with no count", () => {
    const csv = [
      "Counted Quantity,Item,State,Serial / Batch,Storage Unit",
      "1,SER,Found,SN-1,A1",
      ",SER,Not counted,SN-2,A1",
      "4,BAT,,LOT-1,A1"
    ].join("\n");
    expect(parseInventoryCountCsv(csv)).toEqual({
      rows: [row(2, "SER", "A1", "SN-1", 1), row(4, "BAT", "A1", "LOT-1", 4)],
      errors: []
    });
  });
  it("names a missing column", () => {
    expect(parseInventoryCountCsv("Item,Storage Unit\nSER,A1").errors).toEqual([
      { line: 1, message: "Missing column: Serial / Batch, Counted Quantity" }
    ]);
  });
  it("refuses a quantity that is not a number of 0 or more", () => {
    const csv =
      "Item,Storage Unit,Serial / Batch,Counted Quantity\nSER,A1,SN-1,-1";
    expect(parseInventoryCountCsv(csv).errors[0].line).toBe(2);
  });
});

describe("planInventoryCountImport", () => {
  it("counts listed units and marks unlisted units of the group Missing", () => {
    expect(plan([row(2, "SER", "A1", "SN-1", 1)])).toEqual({
      updates: [
        { lineId: "ln1", countedQuantity: 1 },
        { lineId: "ln2", countedQuantity: 0 }
      ],
      inserts: [],
      deletes: []
    });
  });
  it("adds a unit the count expects in another bin, keeping its entity", () => {
    const result = plan([row(2, "SER", "A1", "SN-3", 1)]);
    expect("inserts" in result && result.inserts).toEqual([
      {
        itemId: "ser",
        storageUnitId: "A1",
        trackedEntityId: "e3",
        readableId: "SN-3",
        countedQuantity: 1
      }
    ]);
  });
  it("adds an unknown number as a new unit", () => {
    const result = plan([row(2, "SER", "A1", "SN-NEW", 1)]);
    expect("inserts" in result && result.inserts).toEqual([
      {
        itemId: "ser",
        storageUnitId: "A1",
        trackedEntityId: null,
        readableId: "SN-NEW",
        countedQuantity: 1
      }
    ]);
  });
  it("counts serial rows with no number against the oldest unnumbered units", () => {
    const result = plan([row(2, "SER", "B2", "", 1)]);
    expect("updates" in result && result.updates).toEqual(
      expect.arrayContaining([
        { lineId: "u1", countedQuantity: 1 },
        { lineId: "u2", countedQuantity: 0 },
        { lineId: "ln3", countedQuantity: 0 }
      ])
    );
  });
  it("counts an untracked item on its group line", () => {
    const result = plan([row(2, "INV", "A1", "", 7)]);
    expect("updates" in result && result.updates).toEqual([
      { lineId: "lnI", countedQuantity: 7 }
    ]);
  });
  it("collects every error and plans no write", () => {
    expect(
      plan([
        row(2, "NOPE", "A1", "SN-1", 1),
        row(3, "SER", "Z9", "SN-1", 1),
        row(4, "SER", "A1", "SN-1", 2),
        row(5, "INV", "A1", "X", 1),
        row(6, "BAT", "A1", "", 1),
        row(7, "SER", "B2", "", 3)
      ])
    ).toEqual({
      errors: [
        { line: 2, message: 'Unknown item "NOPE"' },
        { line: 3, message: 'Unknown storage unit "Z9" at this location' },
        { line: 4, message: "A serial number is counted as 0 or 1" },
        {
          line: 5,
          message:
            "INV has no serial or batch tracking. Leave Serial / Batch empty."
        },
        { line: 6, message: "Batch number is required" },
        {
          line: 7,
          message:
            "Only 2 unit(s) here have no serial number. Give each extra unit its serial number."
        }
      ]
    });
  });
  it("refuses a unit listed twice in one storage unit", () => {
    const result = plan([
      row(2, "SER", "A1", "SN-1", 1),
      row(3, "SER", "A1", "SN-1", 1)
    ]);
    expect(result).toEqual({
      errors: [
        { line: 3, message: "SN-1 is listed twice in this storage unit" }
      ]
    });
  });
});
