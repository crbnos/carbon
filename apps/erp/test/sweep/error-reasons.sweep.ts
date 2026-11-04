// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Real database refusals, end to end: a service function called the way a
 * route calls it (`toResult`) against a seeded company, for writes the
 * database is certain to refuse. Each case first proves the refusal is
 * certain (a unique index, a foreign key that blocks the delete), so nothing
 * is ever written. Run with `pnpm sweep:tools`.
 */

import { toResult } from "@carbon/api/service-fn.server";
import { getUserScopedClient } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { NOT_APPLIED_TEXT, reasonText } from "@carbon/utils";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { router } from "~/modules/router.server";
import { contextFor } from "~/modules/service-context.server";
import { getDatabaseClient } from "~/services/database.server";
import { companyGroupOf, target } from "./shared";

const db = getDatabaseClient();

type Refusal = {
  category: string;
  message: string;
  title?: string;
  reason?: Parameters<typeof reasonText>[0];
};

async function caller() {
  const { companyId, userId } = await target(db);
  const companyGroupId = await companyGroupOf(db, companyId);
  const claims = await getUserClaims(userId, companyId);
  const ctx = contextFor({
    kind: "user",
    userId,
    permissions: claims.permissions,
    companyId,
    companyGroupId,
    client: await getUserScopedClient(userId)
  });
  return { companyId, ctx };
}

async function refusalOf(work: Promise<unknown>): Promise<Refusal> {
  const result = toResult(
    (await work) as Parameters<typeof toResult>[0]
  ) as { error: Refusal | null };
  if (!result.error) throw new Error("The write succeeded; it had to be refused.");
  return result.error;
}

/** The text the toast shows: its title, and its second line when there is one. */
function toastText(error: Refusal) {
  const title = error.title ?? error.message;
  const reason = error.reason ? reasonText(error.reason) : null;
  return { title, reason: reason && !title.includes(reason) ? reason : null };
}

async function hasUniqueIndex(table: string, columns: string[]) {
  const found = await sql<{ columns: string[] }>`
    select array_agg(a.attname::text order by a.attname) as columns
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where c.relname = ${table} and i.indisunique
    group by i.indexrelid`.execute(db);
  const wanted = [...columns].sort().join(",");
  return found.rows.some((row) => [...row.columns].sort().join(",") === wanted);
}

/** True when deleting a referenced `parent` row is refused (NO ACTION or RESTRICT). */
async function deleteIsBlocked(child: string, column: string, parent: string) {
  const found = await sql<{ action: string }>`
    select con.confdeltype::text as action
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid and c.relname = ${child}
    join pg_class p on p.oid = con.confrelid and p.relname = ${parent}
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(con.conkey)
    where con.contype = 'f' and a.attname = ${column}`.execute(db);
  return (
    found.rows.length > 0 && found.rows.every((row) => ["a", "r"].includes(row.action))
  );
}

describe("database refusals reach the toast with their reason", () => {
  it("a duplicate name says the record already exists", async () => {
    const { companyId, ctx } = await caller();
    expect(await hasUniqueIndex("supplierType", ["name", "companyId"])).toBe(true);
    const existing = await sql<{ name: string }>`
      select "name" from "supplierType" where "companyId" = ${companyId} limit 1`.execute(db);
    const name = existing.rows[0]?.name;
    if (!name) throw new Error("The seeded company has no supplier type to copy.");

    const error = await refusalOf(
      router.purchasing.createSupplierType(ctx, { name })
    );
    expect(error.category).toBe("conflict");
    // Postgres leaves the "Key (name, companyId)=…" detail out for a table with
    // row-level security, so a signed-in user is never told which field.
    expect(toastText(error).title).toBe("A record with these values already exists.");
  });

  it("deleting a record still in use says what uses it", async () => {
    const { companyId, ctx } = await caller();
    // A blocking key: the whole delete is refused, so nothing is removed.
    expect(
      await deleteIsBlocked("methodMaterial", "unitOfMeasureCode", "unitOfMeasure")
    ).toBe(true);
    const used = await sql<{ id: string }>`
      select u."id" from "unitOfMeasure" u
      where u."companyId" = ${companyId}
      and exists (
        select 1 from "methodMaterial" m
        where m."unitOfMeasureCode" = u."code" and m."companyId" = u."companyId"
      )
      and u."code" <> 'EA'
      limit 1`.execute(db);
    const id = used.rows[0]?.id;
    if (!id) throw new Error("No unit of measure is in use in the seeded company.");

    const error = await refusalOf(router.items.deleteUnitOfMeasure(ctx, { id }));
    expect(error.category).toBe("conflict");
    // The unit of measure's own trigger refuses first, and lists what uses it.
    expect(toastText(error).title).toMatch(/because it is in use: \w+ \(\d+\)/);
  });

  it("a database rule's own text is the second line", async () => {
    const { companyId, ctx } = await caller();
    const each = await sql<{ id: string }>`
      select "id" from "unitOfMeasure"
      where "companyId" = ${companyId} and "code" = 'EA'`.execute(db);
    const id = each.rows[0]?.id;
    if (!id) throw new Error("The seeded company has no EA unit of measure.");

    const error = await refusalOf(router.items.deleteUnitOfMeasure(ctx, { id }));
    expect(error.reason?.code).toBe("raw");
    expect(toastText(error).reason).toBe(
      "The Each (EA) unit of measure cannot be deleted"
    );
  });

  it("a write to a record that is gone says so instead of succeeding", async () => {
    const { ctx } = await caller();
    const error = await refusalOf(
      router.purchasing.deleteSupplierType(ctx, {
        supplierTypeId: "sweep-no-such-supplier-type"
      })
    );
    expect(error.category).toBe("internal");
    expect(error.reason?.code).toBe("notApplied");
    expect(toastText(error).reason).toBe(NOT_APPLIED_TEXT);
  });
});
