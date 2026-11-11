// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import type { ColumnInfo, ForeignKey, TableInfo } from "./catalog";
import {
  anyOf,
  buildDanglingPredicate,
  buildExclusionPredicate,
  buildScopeFilter,
  formatScopeViolations,
  referenceEdges,
  scopeEdges
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
      `"pickMethod"."itemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "item" AS __parent WHERE __parent."id" = "pickMethod"."itemId" AND ("companyId" = $1 OR "companyId" IS NULL))`
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
    expect(text).toContain(`"operationId" = ANY(`);
    expect(text).toContain(`"dependsOnId" = ANY(`);
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
      `NOT EXISTS (SELECT 1 FROM "job" AS __parent WHERE __parent."id" = "jobOperationDependency"."jobId"`
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
});

describe("buildDanglingPredicate", () => {
  // The demo-revert shape: a kept identity row whose parent the wipe removed.
  const ability = table("ability", [col("id"), col("companyId")]);
  const employeeAbility = table(
    "employeeAbility",
    [col("id"), col("companyId"), col("employeeId"), col("abilityId")],
    [fk("employeeId", "user"), fk("abilityId", "ability")]
  );
  const names = new Map([ability, employeeAbility].map((t) => [t.name, t]));

  it("matches a NOT-NULL FK whose parent row is missing anywhere, not just out of scope", () => {
    const predicate = buildDanglingPredicate(employeeAbility, names);
    const text = compile(predicate!);
    expect(text).toContain(`"abilityId" NOT IN (SELECT "id" FROM "ability")`);
    // Retained targets (user, employee, …) are never treated as dangling.
    expect(text).not.toContain(`"user"`);
  });

  it("returns null when only nullable FKs could dangle", () => {
    const optional = table(
      "optionalLink",
      [col("id"), col("companyId"), col("abilityId", { nullable: true })],
      [fk("abilityId", "ability")]
    );
    expect(buildDanglingPredicate(optional, names)).toBeNull();
  });
});

describe("intercompany transactions", () => {
  const journalLine = table("journalLine", [col("id"), col("companyId")]);
  const ict = {
    ...table(
      "intercompanyTransaction",
      [
        col("id"),
        col("companyGroupId"),
        col("sourceCompanyId"),
        col("targetCompanyId"),
        col("sourceJournalLineId")
      ],
      [fk("sourceJournalLineId", "journalLine")]
    ),
    scope: { kind: "direct", column: "companyGroupId" },
    scopeColumn: "companyGroupId"
  } as TableInfo;
  const names = new Map([journalLine, ict].map((t) => [t.name, t]));

  it("scopes a company to the transactions it is a party to", () => {
    const { sql: text, parameters } = sql`SELECT 1 WHERE ${buildScopeFilter(
      ict,
      names,
      "C",
      "G"
    )}`.compile(db);
    expect(text).toContain(
      `"companyGroupId" = $1 AND $2 IN ("sourceCompanyId", "targetCompanyId")`
    );
    expect(parameters).toEqual(["G", "C"]);
  });

  it("never treats the counterparty's journal line as escaping scope", () => {
    expect(scopeEdges(ict, new Set(names.keys()), names)).toEqual([]);
    expect(referenceEdges(ict, names)).toEqual([]);
  });
});

describe("referenceEdges", () => {
  it("checks nullable refs too, and never retained or global ones", () => {
    const edges = referenceEdges(pickMethod, byName);
    // defaultStorageUnitId targets a table outside this catalog (global).
    expect(edges.map((e) => `${e.column}→${e.parent.name}`)).toEqual([
      "itemId→item"
    ]);
    const withStorage = new Map(byName).set(
      "storageUnit",
      table("storageUnit", [col("id"), col("companyId")])
    );
    expect(
      referenceEdges(pickMethod, withStorage).map((e) => e.column)
    ).toEqual(["itemId", "defaultStorageUnitId"]);
  });
});

describe("anyOf", () => {
  it("binds one array, cast to the id column's type", () => {
    const ids = Array.from({ length: 70_000 }, (_, i) => `id${i}`);
    const compiled = sql`SELECT 1 WHERE ${anyOf("id", ids, "uuid")}`.compile(
      db
    );
    expect(compiled.sql).toBe(`SELECT 1 WHERE "id" = ANY($1::uuid[])`);
    expect(compiled.parameters).toHaveLength(1);
  });
});
