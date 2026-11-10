// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it } from "vitest";
import {
  backupFromRows,
  type CompanyBackup,
  collectRows,
  type Manifest,
  type Row
} from "./format";
import {
  applyTableRenames,
  LIVE_COLUMN_RENAMES,
  TABLE_RENAMES
} from "./renames";

const catalog = (...names: string[]) => ({
  tables: names.map((name) => ({ name }))
});

const stored = (
  tables: Array<{ name: string; rows: number; columns: string[] }>,
  data: Record<string, Row[]>
) => backupFromRows({ tables } as unknown as Manifest, data);

const backup = (tables: Record<string, number>) =>
  stored(
    Object.entries(tables).map(([name, rows]) => ({
      name,
      rows,
      columns: ["id", "companyId"]
    })),
    Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [
        name,
        Array.from({ length: rows }, (_, i) => ({ id: `${name}-${i}` }))
      ])
    )
  );

// The tables the manifest lists, and the ones that read back rows.
const names = async (b: CompanyBackup) => {
  const manifest = b.manifest.tables.map((t) => t.name).sort();
  const data: string[] = [];
  for (const name of manifest) {
    if ((await collectRows(b, name)).length > 0) data.push(name);
  }
  return { manifest, data };
};

// TABLE_RENAMES is a live constant the whole repo shares; mutate and restore.
const withRenames = (entries: Record<string, string | null>) => {
  Object.assign(TABLE_RENAMES, entries);
};
afterEach(() => {
  for (const k of Object.keys(TABLE_RENAMES)) delete TABLE_RENAMES[k];
});

describe("applyTableRenames", () => {
  it("leaves a backup alone when every table still exists", async () => {
    const out = applyTableRenames(
      catalog("job", "quote"),
      backup({ job: 2, quote: 1 })
    );
    expect(await names(out)).toEqual({
      manifest: ["job", "quote"],
      data: ["job", "quote"]
    });
  });

  it("moves a renamed table's rows onto the new name", async () => {
    withRenames({ quoteLine: "quotationLine" });
    const out = applyTableRenames(
      catalog("quotationLine"),
      backup({ quoteLine: 3 })
    );
    expect(await names(out)).toEqual({
      manifest: ["quotationLine"],
      data: ["quotationLine"]
    });
    expect(await collectRows(out, "quotationLine")).toHaveLength(3);
    expect(out.manifest.tables[0]!.rows).toBe(3);
  });

  it("drops a table mapped to null, rows and all", async () => {
    withRenames({ oldFeature: null });
    const out = applyTableRenames(
      catalog("job"),
      backup({ job: 1, oldFeature: 5 })
    );
    expect(await names(out)).toEqual({ manifest: ["job"], data: ["job"] });
  });

  it("leaves an UNMAPPED missing table in place so the gate refuses it", async () => {
    const out = applyTableRenames(
      catalog("job"),
      backup({ job: 1, vanished: 2 })
    );
    expect(await names(out)).toEqual({
      manifest: ["job", "vanished"],
      data: ["job", "vanished"]
    });
  });

  it("leaves it in place when the mapping points at a table that is also gone", async () => {
    withRenames({ a: "b" });
    const out = applyTableRenames(catalog("job"), backup({ a: 1 }));
    expect(await names(out)).toEqual({ manifest: ["a"], data: ["a"] });
  });

  it("ignores a stale mapping once the old name is back — the A→B→A cycle", async () => {
    // Both entries are present after renaming A→B and then B→A.
    withRenames({ a: "b", b: "a" });
    const out = applyTableRenames(catalog("a"), backup({ a: 4 }));
    expect(await names(out)).toEqual({ manifest: ["a"], data: ["a"] });
    expect(await collectRows(out, "a")).toHaveLength(4);
  });

  it("reads a mid-cycle backup (taken while the table was B) back into A", async () => {
    withRenames({ a: "b", b: "a" });
    const out = applyTableRenames(catalog("a"), backup({ b: 4 }));
    expect(await names(out)).toEqual({ manifest: ["a"], data: ["a"] });
    expect(await collectRows(out, "a")).toHaveLength(4);
  });

  it("refuses to merge when the backup carries BOTH names", async () => {
    withRenames({ a: "b" });
    const out = applyTableRenames(catalog("b"), backup({ a: 1, b: 2 }));
    // `a` is left unresolved rather than folded into `b` — the gate then refuses.
    expect(await names(out)).toEqual({
      manifest: ["a", "b"],
      data: ["a", "b"]
    });
    expect(await collectRows(out, "b")).toHaveLength(2);
  });

  it("moves a renamed table's columns and row keys onto their current names", async () => {
    withRenames({ cardTransaction: "charge" });
    const data = {
      cardTransaction: [
        { id: "x", companyId: "c", cardTransactionId: "CARD-1" }
      ]
    };
    const out = applyTableRenames(
      catalog("charge"),
      stored(
        [
          {
            name: "cardTransaction",
            rows: 1,
            columns: ["id", "companyId", "cardTransactionId"]
          }
        ],
        data
      )
    );
    expect(out.manifest.tables[0]!.columns).toEqual([
      "id",
      "companyId",
      "chargeId"
    ]);
    expect(await collectRows(out, "charge")).toEqual([
      { id: "x", companyId: "c", chargeId: "CARD-1" }
    ]);
    expect(data.cardTransaction[0]).toHaveProperty("cardTransactionId");
  });

  it("renames a column on a table that kept its name", async () => {
    const data = { supplierPart: [{ id: "sp", unitPrice: 4.25 }] };
    const out = applyTableRenames(
      catalog("supplierPart"),
      stored(
        [{ name: "supplierPart", rows: 1, columns: ["id", "unitPrice"] }],
        data
      )
    );
    expect(out.manifest.tables[0]!.columns).toEqual([
      "id",
      "supplierUnitPrice"
    ]);
    expect(await collectRows(out, "supplierPart")).toEqual([
      { id: "sp", supplierUnitPrice: 4.25 }
    ]);
    expect(data.supplierPart[0]).toHaveProperty("unitPrice");
  });

  it("leaves a backup taken after the column rename alone", async () => {
    expect(LIVE_COLUMN_RENAMES.supplierPart).toEqual({
      unitPrice: "supplierUnitPrice"
    });
    const tables = [
      { name: "supplierPart", rows: 1, columns: ["id", "supplierUnitPrice"] }
    ];
    const rows = [{ id: "sp", supplierUnitPrice: 4.25 }];
    const out = applyTableRenames(
      catalog("supplierPart"),
      stored(tables, { supplierPart: rows })
    );
    expect(out.manifest.tables[0]).toBe(tables[0]);
    expect(await collectRows(out, "supplierPart")).toEqual(rows);
  });

  it("does not mutate the backup it was given", async () => {
    withRenames({ quoteLine: "quotationLine" });
    const input = backup({ quoteLine: 1 });
    applyTableRenames(catalog("quotationLine"), input);
    expect(input.manifest.tables[0]!.name).toBe("quoteLine");
    expect(await collectRows(input, "quoteLine")).toHaveLength(1);
  });
});
