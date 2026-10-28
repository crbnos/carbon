// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack; skipped without one. A process's FKs cascade
// (procedures, its ability and through it the work centers requiring it), so
// deleteProcess must refuse while anything uses it, including a reference that
// lands while the delete runs.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as resources from "../../app/modules/resources/resources.server";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `resdel-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const companyId = `${prefix}-company`;
const groupId = `${prefix}-group`;
const createdBy = "system";

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

const ctx = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: companyId, groupId },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

/** A process with an ability, as `requiresAbility` creates it. */
async function processWithAbility(name: string) {
  const processId = `${prefix}-${name}`;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: `${prefix} ${name}`,
        defaultStandardFactor: "Minutes/Piece",
        requiresAbility: true,
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("ability")
      .values({ id: `${processId}-ability`, processId, companyId, createdBy })
      .execute();
  });
  return { processId, abilityId: `${processId}-ability` };
}

const exists = async (table: "process" | "workCenter" | "procedure", id: string) => {
  const row = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM ${sql.id(table)} WHERE "id" = ${id}`.execute(db);
  return row.rows[0]?.n === 1;
};

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx.deleteFrom("company").where("id", "=", companyId).execute();
    await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
    await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
      trx
    );
    await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
      trx
    );
  });
  await db.destroy();
});

describeLocal("deleteProcess", () => {
  it("refuses a process a procedure uses and keeps the procedure", async () => {
    const { processId } = await processWithAbility("procedure");
    const procedureId = `${prefix}-procedure`;
    await db
      .insertInto("procedure")
      .values({
        id: procedureId,
        name: `${prefix} procedure`,
        processId,
        companyId,
        createdBy
      })
      .execute();

    const result = await resources.deleteProcess(ctx(), { processId });

    expect(result.error?.category).toBe("conflict");
    expect(await exists("process", processId)).toBe(true);
    expect(await exists("procedure", procedureId)).toBe(true);
  });

  it("deletes a process nothing uses, with its work center links", async () => {
    const { processId } = await processWithAbility("unused");
    const workCenterId = `${prefix}-wc-linked`;
    await db
      .insertInto("workCenter")
      .values({ id: workCenterId, name: workCenterId, companyId, createdBy })
      .execute();
    await db
      .insertInto("workCenterProcess")
      .values({ workCenterId, processId, companyId, createdBy })
      .execute();

    const result = await resources.deleteProcess(ctx(), { processId });

    expect(result.error).toBeNull();
    expect(await exists("process", processId)).toBe(false);
    expect(await exists("workCenter", workCenterId)).toBe(true);
  });

  it("refuses when a work center requiring its ability commits during the delete", async () => {
    const { processId, abilityId } = await processWithAbility("race");
    const workCenterId = `${prefix}-wc-race`;

    // A second session inserts the work center and holds its transaction open:
    // the insert key-share locks the ability row, not the process row.
    const other = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query(`SET LOCAL "app.sync_in_progress" = 'true'`);
      await other.query(
        `INSERT INTO "workCenter" ("id", "name", "requiredAbilityId", "companyId", "createdBy")
         VALUES ($1, $1, $2, $3, $4)`,
        [workCenterId, abilityId, companyId, createdBy]
      );

      const pending = resources.deleteProcess(ctx(), { processId });
      await waitForBlockedBackend(other);
      await other.query("COMMIT");

      const result = await pending;
      expect(result.error?.category).toBe("conflict");
      expect(await exists("process", processId)).toBe(true);
      expect(await exists("workCenter", workCenterId)).toBe(true);
    } finally {
      await other.end();
    }
  });
});

/** Wait until some backend is queued on a lock this session holds. */
async function waitForBlockedBackend(holder: Client) {
  const { rows } = await holder.query<{ pid: number }>(
    "SELECT pg_backend_pid() AS pid"
  );
  const pid = rows[0]!.pid;
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocked = await holder.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid))",
      [pid]
    );
    if (blocked.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The delete never waited on the open transaction");
}
