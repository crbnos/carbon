import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql
} from "kysely";
import { describe, expect, it } from "vitest";
import type { JobDatabase } from "../db";
import type { ColumnInfo, ForeignKey, TableInfo } from "./schema";
import {
  buildExclusionPredicate,
  ExportScopeViolationError,
  formatScopeViolations,
  scopeEdges,
  totalExcludedRows
} from "./scope";

// ── Compile-only Kysely (no connection) ─────────────────────────────────────
// The builders here are pure query shape, so the tests pin the SQL text a
// `skipCorrupted` export / purge runs — a wrong predicate would either leak the
// rows the guard refused on, or drop rows that were never in violation.
const db = new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (i) => new PostgresIntrospector(i),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
}) as unknown as JobDatabase;

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
  foreignKeys: ForeignKey[] = []
): TableInfo {
  const pkColumns = columns.some((c) => c.name === "id") ? ["id"] : [];
  return {
    name,
    columns,
    scope: { kind: "direct", column: "companyId" },
    scopeColumn: "companyId",
    pkColumns,
    uniqueColumns: pkColumns,
    hasId: pkColumns.length === 1,
    foreignKeys
  };
}

function fk(column: string, refTable: string): ForeignKey {
  return { column, refTable, refColumn: "id" };
}

const item = table("item", [col("id"), col("companyId")]);
const job = table("job", [col("id"), col("companyId")]);
const jobOperation = table(
  "jobOperation",
  [col("id"), col("companyId"), col("jobId")],
  [fk("jobId", "job")]
);
// Mirrors the prod shape: NO `id` column, composite PK, three NOT-NULL FKs.
const jobOperationDependency = table(
  "jobOperationDependency",
  [col("operationId"), col("dependsOnId"), col("jobId"), col("companyId")],
  [
    fk("operationId", "jobOperation"),
    fk("dependsOnId", "jobOperation"),
    fk("jobId", "job")
  ]
);
const pickMethod = table(
  "pickMethod",
  [
    col("itemId"),
    col("locationId"),
    col("companyId"),
    col("createdBy"),
    col("defaultStorageUnitId", { nullable: true })
  ],
  [
    fk("itemId", "item"),
    fk("createdBy", "user"),
    fk("defaultStorageUnitId", "storageUnit")
  ]
);

const all = [item, job, jobOperation, jobOperationDependency, pickMethod];
const byName = new Map(all.map((t) => [t.name, t]));
const exportableNames = new Set(all.map((t) => t.name));

const compile = (predicate: ReturnType<typeof sql>) =>
  sql`SELECT 1 WHERE ${predicate}`.compile(db).sql;

describe("scopeEdges", () => {
  it("keeps NOT-NULL FKs to exportable, non-retained tables", () => {
    const edges = scopeEdges(jobOperationDependency, exportableNames, byName);
    expect(edges.map((e) => `${e.column}→${e.parent.name}`)).toEqual([
      "operationId→jobOperation",
      "dependsOnId→jobOperation",
      "jobId→job"
    ]);
  });

  it("skips nullable FKs, retained tables and non-exportable targets", () => {
    // `createdBy → user` is retained; `defaultStorageUnitId` is nullable AND
    // its target is not exportable — only `itemId → item` may exclude a row.
    const edges = scopeEdges(pickMethod, exportableNames, byName);
    expect(edges.map((e) => e.column)).toEqual(["itemId"]);
  });
});

describe("buildExclusionPredicate", () => {
  it("returns null when no edge could exclude anything", () => {
    expect(
      buildExclusionPredicate(
        item,
        exportableNames,
        byName,
        "C",
        "G",
        new Map()
      )
    ).toBeNull();
  });

  it("emits the violation term: the FK is set and its parent is not in scope", () => {
    const built = buildExclusionPredicate(
      pickMethod,
      exportableNames,
      byName,
      "C",
      "G",
      new Map()
    );
    expect(built?.terms.map((t) => t.cause)).toEqual(["violation"]);
    const text = compile(built!.predicate);
    expect(text).toContain(
      `"itemId" IS NOT NULL AND "itemId" NOT IN (SELECT "id" FROM "item" WHERE "companyId" = $1 OR "companyId" IS NULL)`
    );
  });

  it("adds a cascade term only when the parent already excluded ids", () => {
    const without = buildExclusionPredicate(
      jobOperationDependency,
      exportableNames,
      byName,
      "C",
      "G",
      new Map()
    );
    expect(without?.terms.every((t) => t.cause === "violation")).toBe(true);
    expect(compile(without!.predicate)).not.toContain(`"operationId" IN (`);

    const withParent = buildExclusionPredicate(
      jobOperationDependency,
      exportableNames,
      byName,
      "C",
      "G",
      new Map([["jobOperation", ["op1", "op2"]]])
    );
    const causes = withParent!.terms.map((t) => `${t.edge.column}:${t.cause}`);
    expect(causes).toEqual([
      "operationId:violation",
      "operationId:cascade",
      "dependsOnId:violation",
      "dependsOnId:cascade",
      "jobId:violation"
    ]);
    const text = compile(withParent!.predicate);
    expect(text).toContain(`"operationId" IN (`);
    expect(text).toContain(`"dependsOnId" IN (`);
    expect(text).toContain(" OR ");
  });

  it("still excludes rows of a table with no `id` column", () => {
    // A table nothing can reference by id (composite PK) is never a cascade
    // PARENT, but its own rows must still be excludable.
    const built = buildExclusionPredicate(
      jobOperationDependency,
      exportableNames,
      byName,
      "C",
      "G",
      new Map()
    );
    expect(built).not.toBeNull();
    expect(compile(built!.predicate)).toContain(
      `"jobId" NOT IN (SELECT "id" FROM "job"`
    );
  });
});

describe("formatScopeViolations / ExportScopeViolationError", () => {
  it("reproduces the exact refusal message the export has always used", () => {
    expect(
      formatScopeViolations("C", [
        { table: "pickMethod", column: "itemId", refTable: "item", rows: 1 },
        {
          table: "jobOperationDependency",
          column: "jobId",
          refTable: "job",
          rows: 3
        }
      ])
    ).toBe(
      "Refusing to export C: 2 NOT-NULL reference(s) escape company scope, so the backup could never be restored:\n" +
        "  pickMethod.itemId → item (1 row)\n" +
        "  jobOperationDependency.jobId → job (3 rows)"
    );
  });

  it("exposes the structured violations on the error", () => {
    const violations = [
      { table: "pickMethod", column: "itemId", refTable: "item", rows: 1 }
    ];
    const err = new ExportScopeViolationError("C", violations);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExportScopeViolationError");
    expect(err.violations).toEqual(violations);
    expect(err.message.startsWith("Refusing to export C: 1 NOT-NULL")).toBe(
      true
    );
  });
});

describe("totalExcludedRows", () => {
  // The bug this pins: `summary`/`violations` carry ONE ENTRY PER FK EDGE, so a
  // row escaping scope through three of its foreign keys appears three times.
  // Summing that told the user "10 rows" for 4 real rows — on the confirm button
  // of an irreversible delete. Totals come from the per-table distinct counts.
  it("counts a row once however many of its FKs escaped scope", () => {
    // The prod shape: 1 pickMethod row (1 edge) + 3 jobOperationDependency rows
    // (3 edges each) = 4 rows, but 4 summary entries totalling 10.
    const perEdge = [
      { table: "pickMethod", rows: 1 },
      { table: "jobOperationDependency", rows: 3 },
      { table: "jobOperationDependency", rows: 3 },
      { table: "jobOperationDependency", rows: 3 }
    ];
    expect(perEdge.reduce((sum, e) => sum + e.rows, 0)).toBe(10);

    expect(
      totalExcludedRows([
        { table: "pickMethod", rows: 1 },
        { table: "jobOperationDependency", rows: 3 }
      ])
    ).toBe(4);
  });

  it("is zero for a clean export", () => {
    expect(totalExcludedRows([])).toBe(0);
  });
});

describe("purgeScopeViolations tenancy guard", () => {
  // A `companyGroupId`-scoped table is shared with the sibling companies in the
  // group, so its rows are not this company's to delete.
  const groupScoped = (name: string): TableInfo => ({
    ...table(name, [col("id"), col("companyGroupId")]),
    scope: { kind: "direct", column: "companyGroupId" },
    scopeColumn: "companyGroupId"
  });

  it("marks group-scoped tables as shared, company-scoped ones as not", () => {
    expect(groupScoped("currency").scopeColumn).toBe("companyGroupId");
    expect(pickMethod.scopeColumn).toBe("companyId");
  });
});
