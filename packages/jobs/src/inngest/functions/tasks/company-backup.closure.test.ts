import { describe, expect, it } from "vitest";
import {
  assertReferentiallyClosed,
  buildRowTransforms,
  type Catalog,
  type ColumnInfo,
  type CompanyBackup,
  type ForeignKey,
  findDanglingReferences,
  isUserScopedIdentityTable,
  selectWipeableTables,
  type TableInfo
} from "./company-backup";

// ── Tiny synthetic-catalog builders ─────────────────────────────────────────
// The closure check is a pure function of (catalog, data), so these tests need
// no database — they pin the ONE definition of "referentially closed" that the
// restore preflight relies on, so a schema/data shape that would dangle a
// restore fails here in CI instead of mid-load in production.

function col(name: string, opts: { nullable?: boolean } = {}): ColumnInfo {
  return {
    name,
    dataType: "text",
    udtName: "text",
    isNullable: opts.nullable ?? false,
    isGenerated: false,
    hasDefault: false
  };
}

function table(
  name: string,
  columns: ColumnInfo[],
  foreignKeys: ForeignKey[] = [],
  opts: { pkColumns?: string[]; uniqueColumns?: string[] } = {}
): TableInfo {
  const pkColumns =
    opts.pkColumns ?? (columns.some((c) => c.name === "id") ? ["id"] : []);
  return {
    name,
    columns,
    scope: { kind: "direct", column: "companyId" },
    scopeColumn: "companyId",
    pkColumns,
    uniqueColumns: opts.uniqueColumns ?? pkColumns,
    hasId: pkColumns.length === 1 && pkColumns[0] === "id",
    foreignKeys
  };
}

function fk(column: string, refTable: string): ForeignKey {
  return { column, refTable, refColumn: "id" };
}

function catalog(tables: TableInfo[]): Catalog {
  return { schemaVersion: "test", tables };
}

const ITEM = table("item", [col("id"), col("companyId")]);
const NCI = table(
  "nonConformanceItem",
  [col("id"), col("itemId"), col("companyId")],
  [fk("itemId", "item")]
);

describe("findDanglingReferences", () => {
  it("returns nothing when every FK resolves within the backup", () => {
    const result = findDanglingReferences(catalog([ITEM, NCI]), {
      item: [{ id: "i1", companyId: "c1" }],
      nonConformanceItem: [{ id: "nc1", itemId: "i1", companyId: "c1" }]
    });
    expect(result).toEqual([]);
  });

  it("flags a NOT-NULL FK pointing at a row the backup omits, aggregating count", () => {
    const result = findDanglingReferences(catalog([ITEM, NCI]), {
      item: [{ id: "i1", companyId: "c1" }],
      nonConformanceItem: [
        { id: "nc1", itemId: "i1", companyId: "c1" },
        { id: "nc2", itemId: "missing-x", companyId: "c1" },
        { id: "nc3", itemId: "missing-y", companyId: "c1" }
      ]
    });
    expect(result).toEqual([
      {
        table: "nonConformanceItem",
        column: "itemId",
        refTable: "item",
        fatal: true,
        sampleValue: "missing-x",
        count: 2
      }
    ]);
  });

  it("treats a missing NULLABLE FK as a non-fatal warning (restore nulls it)", () => {
    const nciNullable = table(
      "nonConformanceItem",
      [col("id"), col("itemId", { nullable: true }), col("companyId")],
      [fk("itemId", "item")]
    );
    const result = findDanglingReferences(catalog([ITEM, nciNullable]), {
      item: [],
      nonConformanceItem: [{ id: "nc1", itemId: "missing", companyId: "c1" }]
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.fatal).toBe(false);
  });

  it("ignores a null FK value", () => {
    const nciNullable = table(
      "nonConformanceItem",
      [col("id"), col("itemId", { nullable: true }), col("companyId")],
      [fk("itemId", "item")]
    );
    const result = findDanglingReferences(catalog([ITEM, nciNullable]), {
      item: [],
      nonConformanceItem: [{ id: "nc1", itemId: null, companyId: "c1" }]
    });
    expect(result).toEqual([]);
  });

  it("ignores FKs to retained tables (user/employee/company/companyGroup)", () => {
    const withUserFk = table(
      "trainingCompletion",
      [col("id"), col("employeeId"), col("companyId")],
      [fk("employeeId", "user")]
    );
    const result = findDanglingReferences(catalog([withUserFk]), {
      trainingCompletion: [
        { id: "t1", employeeId: "some-user-not-in-backup", companyId: "c1" }
      ]
    });
    expect(result).toEqual([]);
  });

  it("ignores FKs to non-scoped global tables absent from the catalog", () => {
    const withGlobalFk = table(
      "part",
      [col("id"), col("unitOfMeasureCode"), col("companyId")],
      [fk("unitOfMeasureCode", "unitOfMeasure")] // not in catalog → stable global
    );
    const result = findDanglingReferences(catalog([withGlobalFk]), {
      part: [{ id: "p1", unitOfMeasureCode: "EA", companyId: "c1" }]
    });
    expect(result).toEqual([]);
  });
});

describe("assertReferentiallyClosed", () => {
  const backup = (
    data: Record<string, Array<Record<string, unknown>>>
  ): CompanyBackup => ({ manifest: {} as CompanyBackup["manifest"], data });

  it("is ok for a self-contained backup", () => {
    const result = assertReferentiallyClosed(
      catalog([ITEM, NCI]),
      backup({
        item: [{ id: "i1", companyId: "c1" }],
        nonConformanceItem: [{ id: "nc1", itemId: "i1", companyId: "c1" }]
      })
    );
    expect(result).toEqual({ ok: true });
  });

  it("fails and names every fatal gap when the backup is not closed", () => {
    const result = assertReferentiallyClosed(
      catalog([ITEM, NCI]),
      backup({
        item: [],
        nonConformanceItem: [{ id: "nc1", itemId: "ghost", companyId: "c1" }]
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("nonConformanceItem.itemId → item");
      expect(result.reason).toContain("ghost");
    }
  });
});

// Foreign-restore re-stamping — pins the bugs that crashed real restores:
// int/serial ids dereffing an undefined idMap, and the user-collapse / dangling-FK
// resolution rules. These only run on remap=true, which the own-restore E2E can't
// exercise — so they live here as a regression net.
describe("buildRowTransforms", () => {
  type RestampCtx = Parameters<typeof buildRowTransforms>[2];
  const ctx = (over: Partial<RestampCtx> = {}): RestampCtx => ({
    remap: true,
    companyId: "target-co",
    userId: "importer",
    targetGroupId: "target-grp",
    sourceCompanyId: "src-co",
    idMaps: new Map<string, Map<string, string>>(),
    idRewrite: new Map<string, string>(),
    ...over
  });

  function apply(
    t: TableInfo,
    row: Record<string, unknown>,
    c: RestampCtx
  ): Record<string, unknown> {
    const transforms = buildRowTransforms(t, t.columns, c);
    const out: Record<string, unknown> = {};
    t.columns.forEach((c2, i) => {
      out[c2.name] = transforms[i]!(row[c2.name]);
    });
    return out;
  }

  it("copies every column verbatim when remap=false (own restore)", () => {
    const t = table("part", [col("id"), col("companyId"), col("name")]);
    const out = apply(
      t,
      { id: "p1", companyId: "src-co", name: "Widget" },
      ctx({ remap: false })
    );
    expect(out).toEqual({ id: "p1", companyId: "src-co", name: "Widget" });
  });

  it("does NOT crash on an int/serial-id table absent from idMaps — keeps id verbatim", () => {
    // Regression: journal/trainingCompletion have a serial `id` and no idMap entry.
    // The pre-fix code dereffed an undefined map here and threw at apply time.
    const t = table("journal", [col("id"), col("companyId")]);
    const out = apply(t, { id: 42, companyId: "src-co" }, ctx());
    expect(out).toEqual({ id: 42, companyId: "target-co" });
  });

  it("remaps a text id present in idMaps and re-stamps companyId", () => {
    const t = table("item", [col("id"), col("companyId")]);
    const idMaps = new Map([["item", new Map([["old", "new"]])]]);
    const out = apply(t, { id: "old", companyId: "src-co" }, ctx({ idMaps }));
    expect(out).toEqual({ id: "new", companyId: "target-co" });
  });

  it("collapses a user/employee FK to the importing user", () => {
    const t = table(
      "salesOrder",
      [col("id"), col("companyId"), col("assignee", { nullable: true })],
      [fk("assignee", "user")]
    );
    const out = apply(
      t,
      { id: "s1", companyId: "src-co", assignee: "someone-else" },
      ctx()
    );
    expect(out.assignee).toBe("importer");
  });

  it("nulls a nullable FK to a scoped row missing from the backup", () => {
    const t = table(
      "job",
      [col("id"), col("companyId"), col("parentId", { nullable: true })],
      [fk("parentId", "job")]
    );
    const idMaps = new Map([["job", new Map([["j1", "jX"]])]]);
    const out = apply(
      t,
      { id: "j1", companyId: "src-co", parentId: "missing" },
      ctx({ idMaps })
    );
    expect(out.parentId).toBeNull();
  });

  it("throws on a NOT-NULL FK to a scoped row missing from the backup", () => {
    const t = table(
      "nonConformanceItem",
      [col("id"), col("companyId"), col("itemId")],
      [fk("itemId", "item")]
    );
    const idMaps = new Map([
      ["nonConformanceItem", new Map([["nc1", "ncX"]])],
      ["item", new Map([["i1", "iX"]])]
    ]);
    expect(() =>
      apply(
        t,
        { id: "nc1", companyId: "src-co", itemId: "ghost" },
        ctx({ idMaps })
      )
    ).toThrow(/isn't in the backup/);
  });
});

describe("isUserScopedIdentityTable", () => {
  it("true when a user FK is in the PRIMARY KEY (employee shape)", () => {
    const t = table(
      "employee",
      [col("id"), col("companyId")],
      [fk("id", "user")],
      {
        pkColumns: ["id", "companyId"],
        uniqueColumns: ["id", "companyId"]
      }
    );
    expect(isUserScopedIdentityTable(t)).toBe(true);
  });

  it("true when a user FK is in a UNIQUE INDEX but not the PK (trainingCompletion shape)", () => {
    const t = table(
      "trainingCompletion",
      [
        col("id"),
        col("trainingAssignmentId"),
        col("employeeId"),
        col("companyId")
      ],
      [fk("employeeId", "user")],
      {
        pkColumns: ["id"],
        uniqueColumns: ["trainingAssignmentId", "employeeId", "period"]
      }
    );
    expect(isUserScopedIdentityTable(t)).toBe(true);
  });

  it("false when the user FK is in no uniqueness constraint (assignee column)", () => {
    const t = table(
      "salesOrder",
      [col("id"), col("companyId"), col("assignee")],
      [fk("assignee", "user")],
      { pkColumns: ["id"], uniqueColumns: ["id"] }
    );
    expect(isUserScopedIdentityTable(t)).toBe(false);
  });
});

describe("selectWipeableTables (identity tables vs foreign restore)", () => {
  // customerAccount is identity (NOT-NULL customerId in its PK → user-keyed); on a
  // foreign restore its parent `customer` is remapped, and CASCADE won't clear it
  // under replica mode, so it must be WIPED (but never reloaded) to avoid dangling.
  const normal = table("customer", [col("id"), col("companyId")]);
  const identity = table(
    "customerAccount",
    [col("id"), col("companyId")],
    [fk("id", "user")],
    { pkColumns: ["id"], uniqueColumns: ["id"] }
  );
  const cat = catalog([normal, identity]);

  it("own restore keeps identity tables OUT of the wipe set", () => {
    const names = selectWipeableTables(cat).map((t) => t.name);
    expect(names).toContain("customer");
    expect(names).not.toContain("customerAccount");
  });

  it("foreign restore (remap) WIPES identity tables so they can't dangle", () => {
    const names = selectWipeableTables(cat, { remap: true }).map((t) => t.name);
    expect(names).toContain("customer");
    expect(names).toContain("customerAccount");
  });
});
