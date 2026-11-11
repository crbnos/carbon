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
import type { TableInfo } from "./catalog";
import { assertLoadedInScope } from "./load";

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

const parent: TableInfo = {
  name: "scopeCheckParent",
  columns: [],
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
const byName = new Map([
  [parent.name, parent],
  [child.name, child]
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
    await sql`INSERT INTO "scopeCheckParent" VALUES ('p-other', 'other')`.execute(
      db
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  /** Write rows the way a load does, check, and always roll back. */
  async function load(rows: { parents: string[][]; children: string[][] }) {
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
        await assertLoadedInScope(trx, [parent, child], byName, {
          companyId: "co",
          companyGroupId: null
        });
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
});
