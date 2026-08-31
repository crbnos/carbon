import { afterEach, describe, expect, it } from "vitest";
import { applyTableRenames, TABLE_RENAMES } from "./renames";

const catalog = (...names: string[]) => ({
  tables: names.map((name) => ({ name }))
});

const backup = (tables: Record<string, number>) => ({
  manifest: {
    tables: Object.entries(tables).map(([name, rows]) => ({
      name,
      rows,
      columns: ["id", "companyId"]
    }))
  },
  data: Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      Array.from({ length: rows }, (_, i) => ({ id: `${name}-${i}` }))
    ])
  )
});

const names = (b: ReturnType<typeof applyTableRenames>) => ({
  manifest: b.manifest.tables.map((t) => t.name).sort(),
  data: Object.keys(b.data).sort()
});

// TABLE_RENAMES is a live constant the whole repo shares; mutate and restore.
const withRenames = (entries: Record<string, string | null>) => {
  Object.assign(TABLE_RENAMES, entries);
};
afterEach(() => {
  for (const k of Object.keys(TABLE_RENAMES)) delete TABLE_RENAMES[k];
});

describe("applyTableRenames", () => {
  it("leaves a backup alone when every table still exists", () => {
    const out = applyTableRenames(
      catalog("job", "quote"),
      backup({ job: 2, quote: 1 })
    );
    expect(names(out)).toEqual({
      manifest: ["job", "quote"],
      data: ["job", "quote"]
    });
  });

  it("moves a renamed table's rows onto the new name", () => {
    withRenames({ quoteLine: "quotationLine" });
    const out = applyTableRenames(
      catalog("quotationLine"),
      backup({ quoteLine: 3 })
    );
    expect(names(out)).toEqual({
      manifest: ["quotationLine"],
      data: ["quotationLine"]
    });
    expect(out.data.quotationLine).toHaveLength(3);
    expect(out.manifest.tables[0]!.rows).toBe(3);
  });

  it("drops a table mapped to null, rows and all", () => {
    withRenames({ oldFeature: null });
    const out = applyTableRenames(
      catalog("job"),
      backup({ job: 1, oldFeature: 5 })
    );
    expect(names(out)).toEqual({ manifest: ["job"], data: ["job"] });
  });

  it("leaves an UNMAPPED missing table in place so the gate refuses it", () => {
    const out = applyTableRenames(
      catalog("job"),
      backup({ job: 1, vanished: 2 })
    );
    expect(names(out)).toEqual({
      manifest: ["job", "vanished"],
      data: ["job", "vanished"]
    });
  });

  it("leaves it in place when the mapping points at a table that is also gone", () => {
    withRenames({ a: "b" });
    const out = applyTableRenames(catalog("job"), backup({ a: 1 }));
    expect(names(out)).toEqual({ manifest: ["a"], data: ["a"] });
  });

  it("ignores a stale mapping once the old name is back — the A→B→A cycle", () => {
    // Both entries are present after renaming A→B and then B→A.
    withRenames({ a: "b", b: "a" });
    const out = applyTableRenames(catalog("a"), backup({ a: 4 }));
    expect(names(out)).toEqual({ manifest: ["a"], data: ["a"] });
    expect(out.data.a).toHaveLength(4);
  });

  it("reads a mid-cycle backup (taken while the table was B) back into A", () => {
    withRenames({ a: "b", b: "a" });
    const out = applyTableRenames(catalog("a"), backup({ b: 4 }));
    expect(names(out)).toEqual({ manifest: ["a"], data: ["a"] });
    expect(out.data.a).toHaveLength(4);
  });

  it("refuses to merge when the backup carries BOTH names", () => {
    withRenames({ a: "b" });
    const out = applyTableRenames(catalog("b"), backup({ a: 1, b: 2 }));
    // `a` is left unresolved rather than folded into `b` — the gate then refuses.
    expect(names(out)).toEqual({ manifest: ["a", "b"], data: ["a", "b"] });
    expect(out.data.b).toHaveLength(2);
  });

  it("does not mutate the backup it was given", () => {
    withRenames({ quoteLine: "quotationLine" });
    const input = backup({ quoteLine: 1 });
    applyTableRenames(catalog("quotationLine"), input);
    expect(Object.keys(input.data)).toEqual(["quoteLine"]);
    expect(input.manifest.tables[0]!.name).toBe("quoteLine");
  });
});
