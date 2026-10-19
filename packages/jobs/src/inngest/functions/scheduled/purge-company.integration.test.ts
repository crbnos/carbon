// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import {
  canSetReplicationRole,
  getCompanyTableCatalog
} from "../tasks/company-backup";
import {
  dropCompanyTables,
  dropOrphanCompanyTables,
  purgeCompany
} from "./purge-company";

const runDatabaseTests = process.env.RUN_PURGE_DB_TESTS === "true";

class Rollback extends Error {}

/** Rows whose foreign key points at a row that no longer exists, per constraint. */
async function danglingForeignKeys(
  trx: Kysely<KyselyDatabase>
): Promise<Map<string, number>> {
  const fks = await sql<{
    child: string;
    parent: string;
    cc: string[];
    pc: string[];
  }>`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
      array(SELECT attname FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY o)::text[] AS cc,
      array(SELECT attname FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY o)::text[] AS pc
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`.execute(trx);

  const counts = new Map<string, number>();
  for (const fk of fks.rows) {
    const notNull = sql.join(
      fk.cc.map((c) => sql`x.${sql.id(c)} IS NOT NULL`),
      sql` AND `
    );
    const match = sql.join(
      fk.cc.map((c, i) => sql`p.${sql.id(fk.pc[i]!)} = x.${sql.id(c)}`),
      sql` AND `
    );
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM ${sql.raw(fk.child)} x
      WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${sql.raw(fk.parent)} p WHERE ${match})`.execute(
      trx
    );
    if (rows[0]!.n > 0)
      counts.set(`${fk.child}(${fk.cc}) -> ${fk.parent}`, rows[0]!.n);
  }
  return counts;
}

describe.skipIf(!runDatabaseTests)("purgeCompany (Postgres)", () => {
  it("deletes a company, posted journals included, leaving no dangling rows", async () => {
    const db = getJobDatabaseClient();
    const replica = await canSetReplicationRole(db);
    expect(replica).toBe(true);
    const catalog = await getCompanyTableCatalog(db);

    // Prefer a company that has posted: a plain cascade cannot delete it.
    const { companyId } = await db
      .selectFrom("company")
      .leftJoin("journal", (join) =>
        join
          .onRef("journal.companyId", "=", "company.id")
          .on("journal.status", "=", "Posted")
      )
      .select("company.id as companyId")
      .orderBy(sql`count("journal"."id")`, "desc")
      .groupBy("company.id")
      .limit(1)
      .executeTakeFirstOrThrow();

    await expect(
      db.transaction().execute(async (trx) => {
        const before = await danglingForeignKeys(trx);
        await purgeCompany(trx, catalog, companyId, { replica });

        const left = await trx
          .selectFrom("company")
          .select("id")
          .where("id", "=", companyId)
          .execute();
        expect(left).toEqual([]);

        await dropCompanyTables(trx, companyId);
        const tables = await sql<{ search: string | null }>`
          SELECT to_regclass(${`public."searchIndex_${companyId}"`})::text AS search`.execute(
          trx
        );
        expect(tables.rows[0]!.search).toBeNull();

        const after = await danglingForeignKeys(trx);
        const added = [...after].filter(
          ([key, n]) => n > (before.get(key) ?? 0)
        );
        expect(added).toEqual([]);
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
  }, 300_000);

  it("drops a company table whose company is gone, and no other", async () => {
    const db = getJobDatabaseClient();
    await expect(
      db.transaction().execute(async (trx) => {
        await sql`CREATE TABLE public."searchIndex_purgetestorphan0000000" (id text)`.execute(
          trx
        );
        // Shares the prefix, but the rest is not a company id: never dropped.
        await sql`CREATE TABLE public."searchIndex_staging" (id text)`.execute(
          trx
        );
        const live = await sql<{ name: string }>`
          SELECT 'searchIndex_' || id AS name FROM "company"`.execute(trx);

        const dropped = await dropOrphanCompanyTables(trx, 10_000);

        expect(dropped).toContain("searchIndex_purgetestorphan0000000");
        expect(dropped).not.toContain("searchIndex_staging");
        for (const { name } of live.rows) expect(dropped).not.toContain(name);
        const left = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'public' AND c.relname = ANY(${dropped})`.execute(
          trx
        );
        expect(left.rows[0]!.n).toBe(0);
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
  }, 300_000);
});
