import { describe, expect, it } from "vitest";
import {
  type Catalog,
  type ColumnInfo,
  type CompanyBackup,
  type ForeignKey,
  isUserScopedIdentityTable,
  selectWipeableTables,
  type TableInfo
} from "./company-backup";
import {
  assertReferentiallyClosed,
  buildRowTransforms,
  findDanglingReferences
} from "./company-backup.transforms";

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

  it("resolves a NOT-NULL FK against target substrate ids (a global row the backup omits)", () => {
    // A company's materialDimension points at a globally-seeded materialForm
    // (companyId IS NULL) that the backup deliberately omits. With no knowledge
    // of the target it reads as a gap; once the target is known to hold that
    // global row (substrate), it resolves. No allow-list, no nullable-column
    // heuristic — driven by the actual ids present in the target.
    const materialForm = table("materialForm", [col("id"), col("companyId")]);
    const materialDimension = table(
      "materialDimension",
      [col("id"), col("materialFormId"), col("companyId")],
      [fk("materialFormId", "materialForm")]
    );
    const cat = catalog([materialForm, materialDimension]);
    const data = {
      materialForm: [], // global rows live in the target seed, not the backup
      materialDimension: [
        { id: "md1", materialFormId: "round-bar", companyId: "c1" }
      ]
    };
    // Without target knowledge the omitted global ref looks like a gap…
    expect(findDanglingReferences(cat, data)).toHaveLength(1);
    // …but when the target is known to hold that global row, it resolves.
    const substrate = new Map([
      ["materialForm", new Set<unknown>(["round-bar"])]
    ]);
    expect(findDanglingReferences(cat, data, substrate)).toEqual([]);
  });

  it("still flags a missing NOT-NULL FK into an ordinary company table (revert did not loosen general closure)", () => {
    // A non-reference company table (item) is NOT in the deferral set, so a
    // dangling NOT-NULL ref to it is a fatal closure gap, as before.
    const result = findDanglingReferences(catalog([ITEM, NCI]), {
      item: [],
      nonConformanceItem: [{ id: "nc1", itemId: "gone", companyId: "c1" }]
    });
    expect(result).toEqual([
      {
        table: "nonConformanceItem",
        column: "itemId",
        refTable: "item",
        fatal: true,
        sampleValue: "gone",
        count: 1
      }
    ]);
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

  it("throws on a NOT-NULL FK to a row in neither the backup nor the target", () => {
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
    ).toThrow(/isn't in the backup or the target/);
  });

  it("keeps a NOT-NULL FK to a target substrate id (a global row the backup omits)", () => {
    // materialDimension → a globally-seeded materialForm (companyId IS NULL) the
    // backup doesn't carry. Its stable id is present in the target, so the remap
    // keeps it verbatim instead of treating it as a dangling gap.
    const t = table(
      "materialDimension",
      [col("id"), col("companyId"), col("materialFormId")],
      [fk("materialFormId", "materialForm")]
    );
    const idMaps = new Map([
      ["materialDimension", new Map([["md1", "mdX"]])],
      ["materialForm", new Map([["co-form", "co-formX"]])] // company forms remap
    ]);
    const substrateIds = new Map([
      ["materialForm", new Set<unknown>(["angle"])] // global form present in target
    ]);
    const out = apply(
      t,
      { id: "md1", companyId: "src-co", materialFormId: "angle" },
      ctx({ idMaps, substrateIds })
    );
    expect(out.materialFormId).toBe("angle");
  });

  it("remaps a company-singleton's id to the target company (its id IS the company)", () => {
    const t = table(
      "companySettings",
      [col("id"), col("companyId"), col("useMetric")],
      [fk("id", "company")]
    );
    const out = apply(
      t,
      { id: "src-co", companyId: "src-co", useMetric: true },
      ctx()
    );
    expect(out).toEqual({
      id: "target-co",
      companyId: "target-co",
      useMetric: true
    });
  });

  it("rewrites a storage path to the shared template prefix when templateIndustryId is set", () => {
    const t = table("item", [
      col("id"),
      col("companyId"),
      col("modelPath", { nullable: true })
    ]);
    const out = apply(
      t,
      { id: "i1", companyId: "src-co", modelPath: "src-co/models/x.stl" },
      ctx({ templateIndustryId: "metal" })
    );
    expect(out.modelPath).toBe("_templates/metal/models/x.stl");
  });

  it("nulls a nullable FK into a skipped (not-imported) table", () => {
    const t = table(
      "thing",
      [col("id"), col("companyId"), col("inviteId", { nullable: true })],
      [fk("inviteId", "invite")]
    );
    const out = apply(
      t,
      { id: "t1", companyId: "src-co", inviteId: "inv1" },
      ctx({ skippedRefTables: new Set(["invite"]) })
    );
    expect(out.inviteId).toBeNull();
  });

  it("soft-records a non-nullable FK to a tenant table not imported, keeping the value", () => {
    const recorded: string[] = [];
    const t = table(
      "thing",
      [col("id"), col("companyId"), col("locationId")],
      [fk("locationId", "location")]
    );
    const out = apply(
      t,
      { id: "t1", companyId: "src-co", locationId: "loc1" },
      ctx({
        catalogTableNames: new Set(["location"]),
        onUnresolvedRef: (d) => recorded.push(d)
      })
    );
    expect(out.locationId).toBe("loc1");
    expect(recorded).toEqual(["thing.locationId -> location"]);
  });

  it("keeps a FK to a global-reference table verbatim (stable ids, not in catalog)", () => {
    const t = table(
      "item",
      [col("id"), col("companyId"), col("uomCode")],
      [fk("uomCode", "unitOfMeasure")]
    );
    const out = apply(
      t,
      { id: "i1", companyId: "src-co", uomCode: "EA" },
      ctx()
    );
    expect(out.uomCode).toBe("EA");
  });

  it("scrubs an email column via the scrubEmail hook", () => {
    const t = table("contact", [
      col("id"),
      col("companyId"),
      col("email", { nullable: true })
    ]);
    const out = apply(
      t,
      { id: "c1", companyId: "src-co", email: "real@person.com" },
      ctx({ scrubEmail: () => "redacted@example.test" })
    );
    expect(out.email).toBe("redacted@example.test");
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
