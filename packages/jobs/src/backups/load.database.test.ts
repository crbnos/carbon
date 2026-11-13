// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The load's scope check against a live local database: only rows the load's
// own transaction wrote are judged. Skipped without a local SUPABASE_DB_URL.

import {
  getPostgresClient,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ColumnInfo, TableInfo } from "./catalog";
import { assertLoadedInScope, rebuildSearchIndex } from "./load";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  try {
    return LOCAL_HOSTS.includes(
      new URL(process.env.SUPABASE_DB_URL ?? "").hostname
    );
  } catch {
    return false;
  }
})();

const col = (name: string): ColumnInfo => ({
  name,
  dataType: "text",
  udtName: "text",
  isNullable: true,
  isGenerated: false,
  hasDefault: false
});

const parent: TableInfo = {
  name: "scopeCheckParent",
  columns: [col("id"), col("companyId")],
  scope: { kind: "direct", column: "companyId" },
  scopeColumn: "companyId",
  pkColumns: ["id"],
  uniqueColumns: ["id"],
  hasId: true,
  foreignKeys: []
};
const child: TableInfo = {
  ...parent,
  name: "scopeCheckChild",
  scope: {
    kind: "via",
    column: "parentId",
    refColumn: "id",
    parent: parent.name
  }
};
// Rows of its own company that reference a parent by a plain FK: optional
// (cleared when it escapes) and required (refused).
const ref: TableInfo = {
  ...parent,
  name: "scopeCheckRef",
  columns: [col("id"), col("companyId"), col("parentId")],
  foreignKeys: [{ column: "parentId", refTable: parent.name, refColumn: "id" }]
};
const requiredRef: TableInfo = {
  ...ref,
  name: "scopeCheckRequiredRef",
  columns: [
    col("id"),
    col("companyId"),
    { ...col("parentId"), isNullable: false }
  ]
};
const byName = new Map([
  [parent.name, parent],
  [child.name, child],
  [ref.name, ref],
  [requiredRef.name, requiredRef]
]);

describe.skipIf(!hasLocalDatabase)("assertLoadedInScope", () => {
  let db: Kysely<KyselyDatabase>;
  const rollback = new Error("rollback");

  // Session temp tables (one pooled connection), with a row another company
  // already had: committed before any load below, so no load wrote it.
  beforeAll(async () => {
    db = getPostgresClient<KyselyDatabase>(
      new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 }),
      PostgresDriver
    );
    await sql`CREATE TEMP TABLE "scopeCheckParent" (id text, "companyId" text)`.execute(
      db
    );
    await sql`CREATE TEMP TABLE "scopeCheckChild" (id text, "parentId" text)`.execute(
      db
    );
    await sql`CREATE TEMP TABLE "scopeCheckRef" (id text, "companyId" text, "parentId" text)`.execute(
      db
    );
    await sql`CREATE TEMP TABLE "scopeCheckRequiredRef" (id text, "companyId" text, "parentId" text NOT NULL)`.execute(
      db
    );
    await sql`INSERT INTO "scopeCheckParent" VALUES ('p-other', 'other'), ('p-shared', NULL)`.execute(
      db
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  /** Write rows the way a load does, check, and always roll back. */
  async function load(rows: {
    parents: string[][];
    children: string[][];
    refs?: Array<[string, string | null]>;
    requiredRefs?: Array<[string, string]>;
    /** Reads the loaded state after the check, before the rollback. */
    inspect?: (trx: Kysely<KyselyDatabase>) => Promise<void>;
  }) {
    try {
      await db.transaction().execute(async (trx) => {
        for (const [id, companyId] of rows.parents) {
          await sql`INSERT INTO "scopeCheckParent" VALUES (${id}, ${companyId})`.execute(
            trx
          );
        }
        for (const [id, parentId] of rows.children) {
          await sql`INSERT INTO "scopeCheckChild" VALUES (${id}, ${parentId})`.execute(
            trx
          );
        }
        for (const [id, parentId] of rows.refs ?? []) {
          await sql`INSERT INTO "scopeCheckRef" VALUES (${id}, 'co', ${parentId})`.execute(
            trx
          );
        }
        for (const [id, parentId] of rows.requiredRefs ?? []) {
          await sql`INSERT INTO "scopeCheckRequiredRef" VALUES (${id}, 'co', ${parentId})`.execute(
            trx
          );
        }
        await assertLoadedInScope(
          trx,
          [parent, child, ref, requiredRef],
          byName,
          { companyId: "co", companyGroupId: null }
        );
        await rows.inspect?.(trx);
        throw rollback;
      });
    } catch (err) {
      if (err === rollback) return null;
      return (err as Error).message;
    }
    return null;
  }

  it("passes rows that all belong to the company, beside another company's", async () => {
    expect(
      await load({ parents: [["p1", "co"]], children: [["c1", "p1"]] })
    ).toBeNull();
  });

  it("refuses a row stamped with another company", async () => {
    expect(await load({ parents: [["p1", "other"]], children: [] })).toContain(
      "scopeCheckParent (1)"
    );
  });

  it("refuses a row with no company", async () => {
    expect(
      await load({ parents: [["p1", null as never]], children: [] })
    ).toContain("scopeCheckParent (1)");
  });

  it("refuses a child hung off another company's parent", async () => {
    expect(
      await load({ parents: [["p1", "co"]], children: [["c1", "p-other"]] })
    ).toContain("scopeCheckChild (1)");
  });

  it("refuses a required reference to another company's row", async () => {
    const message = await load({
      parents: [["p1", "co"]],
      children: [],
      requiredRefs: [["r1", "p-other"]]
    });
    expect(message).toContain(
      "scopeCheckRequiredRef.parentId → scopeCheckParent (1)"
    );
  });

  it("clears an optional reference to another company's row and keeps its own", async () => {
    let parentIds: Array<string | null> = [];
    const message = await load({
      parents: [["p1", "co"]],
      children: [],
      refs: [
        ["r1", "p-other"],
        ["r2", "p1"]
      ],
      inspect: async (trx) => {
        const { rows } = await sql<{ parentId: string | null }>`
          SELECT "parentId" FROM "scopeCheckRef" ORDER BY id`.execute(trx);
        parentIds = rows.map((r) => r.parentId);
      }
    });
    expect(message).toBeNull();
    expect(parentIds).toEqual([null, "p1"]);
  });

  it("passes references to its own rows, to shared substrate, and nulls", async () => {
    expect(
      await load({
        parents: [["p1", "co"]],
        children: [],
        refs: [
          ["r1", "p1"],
          ["r2", "p-shared"],
          ["r3", null]
        ]
      })
    ).toBeNull();
  });
});

describe.skipIf(!hasLocalDatabase)("rebuildSearchIndex", () => {
  let db: Kysely<KyselyDatabase>;

  beforeAll(() => {
    db = getPostgresClient<KyselyDatabase>(
      new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 }),
      PostgresDriver
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it("indexes every customer and drops entries for rows that are gone", async () => {
    const company = await sql<{ id: string; customers: number }>`
      SELECT c."companyId" AS id, count(*)::int AS customers
      FROM customer c GROUP BY 1 ORDER BY 2 DESC LIMIT 1
    `.execute(db);
    const target = company.rows[0];
    if (!target) return;
    const table = sql.id("public", `searchIndex_${target.id}`);
    const rollback = new Error("rollback");
    const counts = await db
      .transaction()
      .execute(async (trx) => {
        await sql`SELECT create_company_search_index(${target.id})`.execute(
          trx
        );
        await sql`INSERT INTO ${table} ("entityType", "entityId", title, link)
          VALUES ('customer', 'gone', 'Gone', '/x/customer/gone')`.execute(trx);
        await rebuildSearchIndex(trx, target.id);
        const { rows } = await sql<{ gone: number; customers: number }>`
          SELECT count(*) FILTER (WHERE "entityId" = 'gone')::int AS gone,
                 count(*) FILTER (WHERE "entityType" = 'customer')::int AS customers
          FROM ${table}`.execute(trx);
        throw Object.assign(rollback, { rows });
      })
      .catch((err) => {
        if (err !== rollback) throw err;
        return (err as Error & { rows: { gone: number; customers: number }[] })
          .rows[0];
      });
    expect(counts).toEqual({ gone: 0, customers: target.customers });
  });
});
