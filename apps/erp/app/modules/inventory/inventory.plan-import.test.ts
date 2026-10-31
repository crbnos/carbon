// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type CountImportItem,
  type CountImportLine,
  planInventoryCountImport
} from "./inventory.service";
import {
  parseInventoryCountCsv,
  protectCsvIdentifier,
  readCsvIdentifier,
  spreadBatchCount
} from "./inventory.utils";

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
  },
  {
    id: "non",
    readableId: "NON",
    readableIdWithRevision: "NON",
    itemTrackingType: "Non-Inventory"
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
  systemQuantity: 1,
  unnumberedSince: null,
  assignedReadableId: null,
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
  quantity: number | null
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
  it("reads the 4 columns in any order; a row with no count is null", () => {
    const csv = [
      "Counted Quantity,Item,State,Serial / Batch,Storage Unit",
      "1,SER,Found,SN-1,A1",
      ",SER,Not counted,SN-2,A1",
      "4,BAT,,LOT-1,A1"
    ].join("\n");
    expect(parseInventoryCountCsv(csv)).toEqual({
      rows: [
        row(2, "SER", "A1", "SN-1", 1),
        row(3, "SER", "A1", "SN-2", null),
        row(4, "BAT", "A1", "LOT-1", 4)
      ],
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

describe("review fixes", () => {
  it("spreads a batch count over the parts in a bin, surplus on the last", () => {
    const parts = [
      { id: "a", systemQuantity: 6 },
      { id: "b", systemQuantity: 4 }
    ];
    expect(spreadBatchCount(parts, 10)).toEqual([
      { lineId: "a", countedQuantity: 6 },
      { lineId: "b", countedQuantity: 4 }
    ]);
    expect(spreadBatchCount(parts, 8)).toEqual([
      { lineId: "a", countedQuantity: 6 },
      { lineId: "b", countedQuantity: 2 }
    ]);
    expect(spreadBatchCount(parts, 3)).toEqual([
      { lineId: "a", countedQuantity: 3 },
      { lineId: "b", countedQuantity: 0 }
    ]);
    expect(spreadBatchCount(parts, 12)).toEqual([
      { lineId: "a", countedQuantity: 6 },
      { lineId: "b", countedQuantity: 6 }
    ]);
  });

  it("spreads an imported batch row over the batch's parts in the bin", () => {
    const result = planInventoryCountImport({
      rows: [row(2, "BAT", "A1", "LOT-1", 10)],
      items,
      storageUnits,
      entities: [
        { id: "l1", itemId: "bat", readableId: "LOT-1" },
        { id: "l2", itemId: "bat", readableId: "LOT-1" }
      ],
      lines: [
        line({
          id: "p1",
          itemId: "bat",
          trackedEntityId: "l1",
          readableId: "LOT-1",
          systemQuantity: 6
        }),
        line({
          id: "p2",
          itemId: "bat",
          trackedEntityId: "l2",
          readableId: "LOT-1",
          systemQuantity: 4
        })
      ]
    });
    expect("updates" in result && result.updates).toEqual([
      { lineId: "p1", countedQuantity: 6 },
      { lineId: "p2", countedQuantity: 4 }
    ]);
  });

  it("refuses an untracked item listed twice in one storage unit", () => {
    expect(
      plan([row(2, "INV", "A1", "", 3), row(3, "INV", "A1", "", 4)])
    ).toEqual({
      errors: [{ line: 3, message: "INV is listed twice in this storage unit" }]
    });
  });

  it("refuses a new serial number listed in 2 storage units", () => {
    expect(
      plan([row(2, "SER", "A1", "SN-NEW", 1), row(3, "SER", "B2", "SN-NEW", 1)])
    ).toEqual({
      errors: [
        {
          line: 3,
          message:
            "SN-NEW is listed in 2 storage units. A serial number is one unit."
        }
      ]
    });
  });

  it("allows a new batch number in 2 storage units", () => {
    const result = plan([
      row(2, "BAT", "A1", "LOT-NEW", 3),
      row(3, "BAT", "B2", "LOT-NEW", 2)
    ]);
    expect(
      "inserts" in result && result.inserts.map((i) => i.storageUnitId)
    ).toEqual(["A1", "B2"]);
  });

  it("round-trips an identifier that starts with a formula character", () => {
    for (const id of [
      "-LOT",
      "'-LOT",
      "'quoted",
      "00123",
      "1e5",
      "SN-1",
      "1001",
      "-42"
    ]) {
      expect(readCsvIdentifier(protectCsvIdentifier(id))).toBe(id);
    }
    expect(protectCsvIdentifier("-LOT")).toBe("'-LOT");
    expect(protectCsvIdentifier("00123")).toBe("'00123");
    expect(protectCsvIdentifier("SN-1")).toBe("SN-1");
    expect(protectCsvIdentifier("1001")).toBe("1001");
    expect(protectCsvIdentifier("123456789012345")).toBe("123456789012345");
    expect(protectCsvIdentifier("1234567890123456")).toBe("'1234567890123456");
    expect(protectCsvIdentifier("12-16")).toBe("'12-16");
    expect(protectCsvIdentifier("Jan-16")).toBe("'Jan-16");
    expect(protectCsvIdentifier("LOT-16")).toBe("LOT-16");
    const csv =
      "Item,Storage Unit,Serial / Batch,Counted Quantity\nBAT,A1,'-LOT,4";
    expect(parseInventoryCountCsv(csv).rows[0].code).toBe("-LOT");
  });

  it("refuses a file that does not parse", () => {
    const csv =
      'Item,Storage Unit,Serial / Batch,Counted Quantity\nSER,A1,"SN-1,1';
    expect(parseInventoryCountCsv(csv).errors.length).toBeGreaterThan(0);
  });

  it("leaves a unit listed with no count as it is", () => {
    expect(
      plan([row(2, "SER", "A1", "SN-1", 1), row(3, "SER", "A1", "SN-2", null)])
    ).toEqual({
      updates: [{ lineId: "ln1", countedQuantity: 1 }],
      inserts: [],
      deletes: []
    });
  });

  it("changes nothing for a group with no counted row", () => {
    expect(
      plan([
        row(2, "SER", "A1", "SN-1", null),
        row(3, "SER", "A1", "SN-2", null)
      ])
    ).toEqual({ updates: [], inserts: [], deletes: [] });
  });

  it("leaves unnumbered units listed with no count as they are", () => {
    const result = plan([
      row(2, "SER", "B2", "", 1),
      row(3, "SER", "B2", "", null)
    ]);
    expect("updates" in result && result.updates).toEqual(
      expect.arrayContaining([
        { lineId: "u1", countedQuantity: 1 },
        { lineId: "ln3", countedQuantity: 0 }
      ])
    );
    expect(
      "updates" in result && result.updates.some((u) => u.lineId === "u2")
    ).toBe(false);
  });

  it("refuses a Non-Inventory item", () => {
    expect(plan([row(2, "NON", "A1", "", 3)])).toEqual({
      errors: [
        {
          line: 2,
          message: "NON is a Non-Inventory item and has no stock to count"
        }
      ]
    });
  });

  it("leaves unnumbered units as they are in a group with no counted row", () => {
    expect(plan([row(2, "SER", "B2", "", null)])).toEqual({
      updates: [],
      inserts: [],
      deletes: []
    });
  });

  it("counts a serial number given while counting on its own unit", () => {
    expect(
      planInventoryCountImport({
        rows: [row(2, "SER", "B2", "SN-NEW", 1), row(3, "SER", "B2", "", 1)],
        items,
        storageUnits,
        entities,
        lines: lines.map((l) =>
          l.id === "u1" ? { ...l, assignedReadableId: "SN-NEW" } : l
        )
      })
    ).toEqual({
      updates: [
        { lineId: "u1", countedQuantity: 1 },
        { lineId: "u2", countedQuantity: 1 },
        { lineId: "ln3", countedQuantity: 0 }
      ],
      inserts: [],
      deletes: []
    });
  });

  it("refuses a row with fewer cells than the header", () => {
    const csv =
      "Item,Storage Unit,Serial / Batch,Counted Quantity\nBAT,A1,LOT-1\nBAT,B2,LOT-1,";
    expect(parseInventoryCountCsv(csv)).toEqual({
      rows: [row(3, "BAT", "B2", "LOT-1", null)],
      errors: [{ line: 2, message: "The row has fewer cells than the header" }]
    });
  });
});
